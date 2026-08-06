'use client';

// Извлечено из projects/[id]/page.tsx при добавлении отдельной Studio-страницы "Клиенты"
// (запрос пользователя 2026-07-30: "готовить все остальные страницы") — раньше StudioClientsTable/
// StudioClientRow были локальными не экспортируемыми функциями внутри одного файла (страница
// проекта показывает только последние 10 клиентов этой же таблицей); теперь нужна вторая
// страница с полным постраничным списком, использующая ту же вёрстку — тот же принцип, что и
// вынос prototype-project-data.ts раньше в этой сессии: как только 2-му месту понадобилось то же
// самое, дублировать стало дороже, чем вынести в общий файл.
import { useState } from 'react';
import { format } from 'date-fns';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Star } from 'lucide-react';
import { api } from '@/lib/api';
import { ClientAvatar } from '@/components/clients/client-avatar';
import { ClientRow, CrossProjectOverlapBadge, DIALOGUE_SOURCE_LABEL, formatDuration } from '@/components/clients/clients-table';
import { StudioPill } from './ui';

const CHANNEL_SHORT_LABEL: Record<string, string> = { TELEGRAM: 'TG' };

// Та же структура, что и оригинальная ClientsTable (запрос пользователя 2026-07-29: "сделай
// почти как в оригинале") — те же 10 колонок в том же порядке, тот же статус-расчёт и
// formatDuration — просто оформление под палитру Studio.
export function StudioClientsTable({
  projectId,
  clients,
  onSelect,
}: {
  projectId: string;
  clients: ClientRow[];
  onSelect: (clientId: string) => void;
}) {
  return (
    <div className="rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
            <th className="px-5 py-3 font-medium">Имя</th>
            <th className="px-5 py-3 font-medium">Канал</th>
            <th className="px-5 py-3 font-medium">Страна</th>
            <th className="px-5 py-3 font-medium text-right">Потрачено</th>
            <th className="px-5 py-3 font-medium">Статус</th>
            <th className="px-5 py-3 font-medium">Бот</th>
            <th className="px-5 py-3 font-medium">Диалог</th>
            <th className="px-5 py-3 font-medium">Подписан</th>
            <th className="px-5 py-3 font-medium">Отписан</th>
            <th className="px-5 py-3 font-medium">Длительность</th>
            <th className="px-5 py-3 font-medium">Ещё в проектах</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
          {clients.map((client) => (
            <StudioClientRow key={client.id} projectId={projectId} client={client} onSelect={() => onSelect(client.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StudioClientRow({ projectId, client, onSelect }: { projectId: string; client: ClientRow; onSelect: () => void }) {
  const queryClient = useQueryClient();
  const [dialogueJustRegistered, setDialogueJustRegistered] = useState(false);
  const registerDialogue = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/clients/${client.id}/dialogue`),
    onSuccess: () => {
      setDialogueJustRegistered(true);
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'recent-clients'] });
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
    },
  });

  return (
    <tr className="cursor-pointer hover:bg-[#F3F5F8] dark:hover:bg-white/5" onClick={onSelect}>
      <td className="px-5 py-3 font-medium">
        <div className="flex items-center gap-2 min-w-0">
          <ClientAvatar
            projectId={projectId}
            clientId={client.id}
            hasAvatar={!!client.tgPhotoUrl}
            fallbackLetter={client.tgFirstName || client.tgUsername || '?'}
          />
          <span className="truncate text-[#131A24] dark:text-[#E9EDF3]">{client.tgFirstName || client.tgUsername || '—'}</span>
          {client.tgIsPremium && <Star className="w-3.5 h-3.5 text-[#1F4E9C] dark:text-[#7BA9EE] fill-current shrink-0" />}
        </div>
      </td>
      <td className="px-5 py-3">
        <StudioPill hue="slate">{(client.channelType && CHANNEL_SHORT_LABEL[client.channelType]) || client.channelType || '—'}</StudioPill>
      </td>
      <td className="px-5 py-3 text-[#5F6B7A] dark:text-[#92A0AF]">{client.country || '—'}</td>
      <td
        className={`px-5 py-3 text-right font-mono tabular-nums ${client.hasPurchase ? 'text-[#1F4E9C] dark:text-[#7BA9EE] font-semibold' : 'text-[#131A24] dark:text-[#E9EDF3]'}`}
      >
        ${Number(client.totalSpent).toFixed(2)}
      </td>
      <td className="px-5 py-3">
        {client.subscribedAt !== null ? (
          client.unsubscribedAt ? (
            <StudioPill hue="slate">Отписался</StudioPill>
          ) : (
            <StudioPill hue="sage">Активен</StudioPill>
          )
        ) : client.externalUnsubscribedAt ? (
          <StudioPill hue="slate">Покинул канал (внеш.)</StudioPill>
        ) : client.externalSubscribedAt ? (
          <StudioPill hue="slate">Подписан (внеш.)</StudioPill>
        ) : (
          <StudioPill hue="slate">Внешний</StudioPill>
        )}
      </td>
      <td className="px-5 py-3">
        {!client.botActivatedAt ? (
          <StudioPill hue="slate">Не активирован</StudioPill>
        ) : !client.isBotActive ? (
          <StudioPill hue="plum">Заблокирован</StudioPill>
        ) : (
          <StudioPill hue="sage">Активирован</StudioPill>
        )}
      </td>
      <td className="px-5 py-3">
        {client.firstDialogueAt ? (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1 text-sm text-[#131A24] dark:text-[#E9EDF3]">
              <MessageCircle className="w-3.5 h-3.5 text-[#5F6B7A] dark:text-[#92A0AF] shrink-0" />
              {format(new Date(client.firstDialogueAt), 'd MMM, HH:mm')}
            </div>
            <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
              {client.subscribedAt
                ? `через ${formatDuration(client.subscribedAt, client.firstDialogueAt)} после подписки`
                : client.dialogueSource
                  ? DIALOGUE_SOURCE_LABEL[client.dialogueSource]
                  : null}
            </div>
          </div>
        ) : dialogueJustRegistered ? (
          <span className="text-xs text-[#1F7A6C] dark:text-[#6FCBBA]">Записан</span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              registerDialogue.mutate();
            }}
            disabled={registerDialogue.isPending}
            className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] underline-offset-2 hover:underline whitespace-nowrap"
          >
            {registerDialogue.isPending ? 'Записываем...' : 'Зарегистрировать'}
          </button>
        )}
      </td>
      <td className="px-5 py-3 text-[#5F6B7A] dark:text-[#92A0AF] whitespace-nowrap">
        {new Date(client.subscribedAt ?? client.externalSubscribedAt ?? client.createdAt).toLocaleDateString('ru-RU')}
      </td>
      <td className="px-5 py-3 text-[#5F6B7A] dark:text-[#92A0AF] whitespace-nowrap">
        {client.unsubscribedAt || client.externalUnsubscribedAt
          ? new Date(client.unsubscribedAt ?? client.externalUnsubscribedAt!).toLocaleDateString('ru-RU')
          : '—'}
      </td>
      <td className="px-5 py-3 text-[#5F6B7A] dark:text-[#92A0AF] whitespace-nowrap">
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
      </td>
      <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
        <CrossProjectOverlapBadge overlap={client.crossProjectOverlap} />
      </td>
    </tr>
  );
}
