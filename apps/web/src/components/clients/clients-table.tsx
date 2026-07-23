'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Star } from 'lucide-react';
import { api } from '@/lib/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ClientAvatar } from '@/components/clients/client-avatar';

export interface ClientRow {
  id: string;
  tgFirstName: string | null;
  tgUsername: string | null;
  tgPhotoUrl: string | null;
  tgIsPremium: boolean | null;
  channelType: string | null;
  country: string | null;
  city: string | null;
  isSubscribed: boolean;
  isBotActive: boolean;
  botActivatedAt: string | null;
  hasPurchase: boolean;
  totalSpent: string;
  createdAt: string;
  subscribedAt: string | null;
  unsubscribedAt: string | null;
  // Вступил в приватный канал не через нашу заявку (запрос пользователя 2026-07-21) —
  // Client.externalSubscribedAt, отдельно от subscribedAt (тот только для реальной атрибуции
  // воронки). Показываем таким реальную дату вступления вместо голого "Внешний".
  externalSubscribedAt: string | null;
  // Диалог (запрос пользователя 2026-07-21) — первое входящее сообщение клиента боту/личному
  // аккаунту (Client.firstDialogueAt, тот же признак, что уже используется в воронке проекта
  // и как триггер автоворонок), уже приходит с бэкенда без изменений — просто раньше не
  // отображалось в списке.
  firstDialogueAt: string | null;
}

interface ClientsTableProps {
  projectId: string;
  clients: ClientRow[];
  onSelect: (clientId: string) => void;
}

// Короткая подпись канала — запрос пользователя 2026-07-21 ("не пиши так длинго телеграм,
// можно просто TG, для экономии места"). Остальные каналы пока не тронуты — не просили.
const CHANNEL_SHORT_LABEL: Record<string, string> = { TELEGRAM: 'TG' };

// "2д 4ч" / "5ч" / "<1ч" — до дней+часов достаточно для решений по контенту/частоте пушей,
// точнее (минуты и т.п.) уже не нужно для этого списка. Экспортирован — переиспользуется
// в ClientDetailDrawer для "первый диалог: через X после подписки" (запрос 2026-07-04).
export function formatDuration(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (ms <= 0) return '<1ч';

  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  if (days > 0) return remainingHours > 0 ? `${days}д ${remainingHours}ч` : `${days}д`;
  return hours > 0 ? `${hours}ч` : '<1ч';
}

// Кнопка "Зарегистрировать диалог" в списке клиентов (запрос пользователя 2026-07-21) — третий
// способ зафиксировать диалог без подключения личного аккаунта, для случаев, когда клиент
// ведётся вообще вне Telegram-бота этого проекта. Бэкенд сам решает "уже был диалог или нет" —
// повторно нажать без вреда, событие в Facebook/TikTok уйдёт только один раз (см.
// ClientsService.recordManualDialogue/applyDialogueUpdate).
function RegisterDialogueButton({ projectId, clientId }: { projectId: string; clientId: string }) {
  const queryClient = useQueryClient();
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/clients/${clientId}/dialogue`),
    onSuccess: () => {
      setDone(true);
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
    },
  });

  if (done) {
    return (
      <Badge variant="outline">
        <MessageCircle className="w-3 h-3 mr-1" /> Есть
      </Badge>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-6 px-2 text-xs"
      disabled={mutation.isPending}
      onClick={(e) => {
        e.stopPropagation();
        mutation.mutate();
      }}
    >
      {mutation.isPending ? 'Записываем...' : 'Зарегистрировать'}
    </Button>
  );
}

export function ClientsTable({ projectId, clients, onSelect }: ClientsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Имя</TableHead>
          <TableHead>Канал</TableHead>
          <TableHead>Страна</TableHead>
          <TableHead>Потрачено</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead>Бот</TableHead>
          <TableHead>Диалог</TableHead>
          <TableHead>Подписан</TableHead>
          <TableHead>Отписан</TableHead>
          <TableHead>Был подписан</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {clients.map((client) => (
          <TableRow key={client.id} className="cursor-pointer" onClick={() => onSelect(client.id)}>
            <TableCell className="font-medium">
              <div className="flex items-center gap-2">
                <ClientAvatar
                  projectId={projectId}
                  clientId={client.id}
                  hasAvatar={!!client.tgPhotoUrl}
                  fallbackLetter={client.tgFirstName || client.tgUsername || '?'}
                />
                <span className="truncate">{client.tgFirstName || client.tgUsername || '—'}</span>
                {client.tgIsPremium && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{(client.channelType && CHANNEL_SHORT_LABEL[client.channelType]) || client.channelType || '—'}</Badge>
            </TableCell>
            <TableCell>{client.country || '—'}</TableCell>
            <TableCell>${Number(client.totalSpent).toFixed(2)}</TableCell>
            <TableCell>
              {/* Баг-репорт пользователя 2026-07-21: "для внешних контактов у всех написано что
                  отписались, хотя они не отписались" — прежняя логика показывала "Отписался"
                  для любого isSubscribed:false, включая внешних холодных контактов, которые
                  никогда не были подписаны вообще (subscribedAt: null). Теперь "Отписался"
                  только когда реально был unsubscribedAt, "Внешний" — когда подписки не было. */}
              {client.subscribedAt !== null ? (
                client.unsubscribedAt ? (
                  <Badge variant="secondary">Отписался</Badge>
                ) : (
                  <Badge>Активен</Badge>
                )
              ) : client.externalSubscribedAt ? (
                <Badge
                  variant="outline"
                  title={format(new Date(client.externalSubscribedAt), 'd MMM yyyy, HH:mm')}
                >
                  Подписан (внеш.)
                </Badge>
              ) : (
                <Badge variant="outline">Внешний</Badge>
              )}
            </TableCell>
            <TableCell>
              {/* Статус бота — отдельная колонка (запрос пользователя 2026-07-21), не путать
                  с колонкой "Статус" выше (та про подписку/воронку). */}
              {!client.botActivatedAt ? (
                <Badge variant="outline">Не активирован</Badge>
              ) : !client.isBotActive ? (
                <Badge variant="destructive">Заблокирован</Badge>
              ) : (
                <Badge>Активирован</Badge>
              )}
            </TableCell>
            <TableCell>
              {client.firstDialogueAt ? (
                <Badge variant="outline" title={format(new Date(client.firstDialogueAt), 'd MMM yyyy, HH:mm')}>
                  <MessageCircle className="w-3 h-3 mr-1" /> Есть
                </Badge>
              ) : (
                <RegisterDialogueButton projectId={projectId} clientId={client.id} />
              )}
            </TableCell>
            <TableCell className="text-gray-500">
              {format(new Date(client.subscribedAt ?? client.externalSubscribedAt ?? client.createdAt), 'd MMM yyyy, HH:mm')}
            </TableCell>
            <TableCell className="text-gray-500">
              {client.unsubscribedAt ? format(new Date(client.unsubscribedAt), 'd MMM yyyy, HH:mm') : '—'}
            </TableCell>
            <TableCell className="text-gray-500">
              {client.subscribedAt
                ? formatDuration(client.subscribedAt, client.unsubscribedAt || new Date().toISOString())
                : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
