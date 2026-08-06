'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Layers, MessageCircle, Star } from 'lucide-react';
import { api } from '@/lib/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
  // Покинул канал — для внешних контактов (запрос пользователя 2026-07-24), отдельно от
  // unsubscribedAt (тот только для настоящей подписки через воронку, см. баг-репорт 2026-07-21
  // про вводящий в заблуждение статус "Отписался" у внешних).
  externalUnsubscribedAt: string | null;
  // Диалог (запрос пользователя 2026-07-21) — первое входящее сообщение клиента боту/личному
  // аккаунту (Client.firstDialogueAt, тот же признак, что уже используется в воронке проекта
  // и как триггер автоворонок), уже приходит с бэкенда без изменений — просто раньше не
  // отображалось в списке.
  firstDialogueAt: string | null;
  // Источник первой регистрации диалога (запрос пользователя 2026-07-23: "сделай чтобы можно
  // было технически отследить откуда зарегистрирован диалог" — баг-репорт про диалог у
  // клиента, который реально не писал) — показывается во всплывающей подсказке над той же
  // галочкой, отдельного UI не потребовалось.
  dialogueSource: 'PERSONAL_ACCOUNT' | 'BOT_DIRECT' | 'MANAGER_CONFIRM' | 'CRM_BUTTON' | null;
  // "Ещё в проектах" (запрос пользователя 2026-07-30) — есть ли этот клиент (по tgUserId) в
  // других проектах компании. visible:true (право CLIENTS_VIEW_CROSS_PROJECT на ЭТОМ проекте,
  // или elevated-роль) — точный список каналов/дат/диалогов; visible:false — только сам факт +
  // было ли где-то диалог и когда, без имён проектов. null — пересечений нет вообще.
  crossProjectOverlap:
    | { visible: true; projects: { projectId: string; projectName: string; joinedAt: string | null; hasDialogue: boolean; dialogueAt: string | null }[] }
    | { visible: false; hasDialogue: boolean; dialogueAt: string | null }
    | null;
}

export const DIALOGUE_SOURCE_LABEL: Record<NonNullable<ClientRow['dialogueSource']>, string> = {
  PERSONAL_ACCOUNT: 'с личного аккаунта',
  BOT_DIRECT: 'через бота (режим "Прямой бот")',
  MANAGER_CONFIRM: 'подтверждено менеджером в боте',
  CRM_BUTTON: 'вручную, кнопкой в CRM',
};

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

// "Xд Yч" / "Xч Yм" / "Xм" / "<1м" — та же идея, что formatDuration выше, но с точностью до
// минут и на входе уже готовые секунды, а не две даты (запрос пользователя 2026-07-30: "среднее
// время которое проходит от подписки до диалога за разные периоды" — агрегат из SQL AVG(),
// под-часовые значения тут обычны и важны для решения, в отличие от per-client списка выше, где
// хватало точности до часов).
export function formatSecondsDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '<1м';
  const totalMinutes = Math.floor(totalSeconds / 60);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return hours > 0 ? `${days}д ${hours}ч` : `${days}д`;
  if (hours > 0) return minutes > 0 ? `${hours}ч ${minutes}м` : `${hours}ч`;
  return minutes > 0 ? `${minutes}м` : '<1м';
}

// Кнопка "Зарегистрировать диалог" в списке клиентов (запрос пользователя 2026-07-21) — третий
// способ зафиксировать диалог без подключения личного аккаунта, для случаев, когда клиент
// ведётся вообще вне Telegram-бота этого проекта. Бэкенд сам решает "уже был диалог или нет" —
// повторно нажать без вреда, событие в Facebook/TikTok уйдёт только один раз (см.
// ClientsService.recordManualDialogue/applyDialogueUpdate).
export function RegisterDialogueButton({ projectId, clientId }: { projectId: string; clientId: string }) {
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

// Бейдж "ещё в проектах" (запрос пользователя 2026-07-30) — переиспользуется и Studio-версией
// таблицы. Иконка Layers — та же, что уже используется для "Пересечение аудиторий" в сайдбаре,
// сознательно тот же визуальный язык для одного и того же понятия.
export function CrossProjectOverlapBadge({ overlap }: { overlap: ClientRow['crossProjectOverlap'] }) {
  if (!overlap) return null;

  if (overlap.visible) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <Badge variant="outline" className="gap-1 cursor-default">
            <Layers className="w-3 h-3" /> {overlap.projects.length}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="space-y-1">
          {overlap.projects.map((p) => (
            <div key={p.projectId} className="text-xs">
              <span className="font-medium">{p.projectName}</span>
              {p.joinedAt && <> — вступил {format(new Date(p.joinedAt), 'd MMM yyyy')}</>}
              {' · '}
              {p.hasDialogue ? `диалог${p.dialogueAt ? ` (${format(new Date(p.dialogueAt), 'd MMM yyyy')})` : ''}` : 'диалога нет'}
            </div>
          ))}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge variant="outline" className="gap-1 cursor-default">
          <Layers className="w-3 h-3" />
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        Есть в другом нашем проекте
        {overlap.hasDialogue ? ` — там был диалог${overlap.dialogueAt ? ` (${format(new Date(overlap.dialogueAt), 'd MMM yyyy')})` : ''}` : ', диалога там нет'}
      </TooltipContent>
    </Tooltip>
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
          <TableHead>Длительность</TableHead>
          <TableHead>Ещё в проектах</TableHead>
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
                  только когда реально был unsubscribedAt, "Внешний" — когда подписки не было.
                  Доп. правка 2026-07-24: у внешних теперь тоже отслеживается уход из канала,
                  отдельным полем externalUnsubscribedAt (не unsubscribedAt — тот статус
                  зарезервирован за настоящей подпиской через воронку). */}
              {client.subscribedAt !== null ? (
                client.unsubscribedAt ? (
                  <Badge variant="secondary">Отписался</Badge>
                ) : (
                  <Badge>Активен</Badge>
                )
              ) : client.externalUnsubscribedAt ? (
                <Badge
                  variant="secondary"
                  title={format(new Date(client.externalUnsubscribedAt), 'd MMM yyyy, HH:mm')}
                >
                  Покинул канал (внеш.)
                </Badge>
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
              {/* Раньше время диалога и задержка от подписки жили только в hover-подсказке
                  (title) над бейджем "Есть" — запрос пользователя 2026-07-30: "во первых надо
                  показать время когда он начал диалог (через сколько после подписки тоже
                  оставь)" — теперь оба значения видны в самой ячейке, без наведения. */}
              {client.firstDialogueAt ? (
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1 text-sm">
                    <MessageCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    {format(new Date(client.firstDialogueAt), 'd MMM, HH:mm')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {client.subscribedAt
                      ? `через ${formatDuration(client.subscribedAt, client.firstDialogueAt)} после подписки`
                      : client.dialogueSource
                        ? DIALOGUE_SOURCE_LABEL[client.dialogueSource]
                        : null}
                  </div>
                </div>
              ) : (
                <RegisterDialogueButton projectId={projectId} clientId={client.id} />
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {format(new Date(client.subscribedAt ?? client.externalSubscribedAt ?? client.createdAt), 'd MMM yyyy, HH:mm')}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {client.unsubscribedAt || client.externalUnsubscribedAt
                ? format(new Date(client.unsubscribedAt ?? client.externalUnsubscribedAt!), 'd MMM yyyy, HH:mm')
                : '—'}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {/* Уточнение 2026-07-24 (пользователь принял живого подписчика @Gmhv4 за
                  отписавшегося — проверено через Bot API getChatMember, она реально ещё в
                  канале): "Был подписан X" читается как завершённое действие даже когда
                  подписка ещё активна (до отписки конец периода — просто "сейчас"). Явная
                  приставка "В канале"/"Был подписан" убирает эту двусмысленность. */}
              {client.subscribedAt ? (
                <>
                  {client.unsubscribedAt ? 'Был подписан' : 'В канале'}{' '}
                  {formatDuration(client.subscribedAt, client.unsubscribedAt || new Date().toISOString())}
                </>
              ) : client.externalSubscribedAt ? (
                <>
                  {client.externalUnsubscribedAt ? 'Был подписан' : 'В канале'}{' '}
                  {formatDuration(client.externalSubscribedAt, client.externalUnsubscribedAt || new Date().toISOString())}
                </>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell onClick={(e) => e.stopPropagation()}>
              <CrossProjectOverlapBadge overlap={client.crossProjectOverlap} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
