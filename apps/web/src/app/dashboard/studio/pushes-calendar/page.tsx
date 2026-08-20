'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Plus, Send, Pencil, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { CalendarGrid } from '@/components/pushes/calendar-grid';
import { DayScheduleList, DayScheduleItem } from '@/components/pushes/day-schedule-list';
import { PushPreviewDialog } from '@/components/pushes/push-preview-dialog';
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../ui';

interface PushRow {
  id: string;
  name: string;
  status: string;
  audienceReachable: number;
  sentCount: number;
  failedCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  project: { id: string; name: string };
}

const STATUS_HUE: Record<string, 'amber' | 'sage' | 'slate' | 'plum' | 'teal'> = {
  DRAFT: 'slate',
  SCHEDULED: 'teal',
  SENDING: 'amber',
  SENT: 'sage',
  CANCELLED: 'plum',
  FAILED: 'plum',
};

// "Рассылки" (запрос пользователя 2026-08-04, переименовано из "Календарь рассылок") — тот же
// календарь по всей компании, что и раньше, плюс подробный список ВСЕХ рассылок ниже
// (GET /pushes) и синяя кнопка создания на единую страницу /pushes/new. Таблица переоформлена
// по образцу Studio-версии списка пушей проекта (STUDIO_CARD/StudioPill), см.
// .../studio/projects/[id]/pushes/page.tsx.
export default function StudioPushesCalendarPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [visibleMonth, setVisibleMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [previewPush, setPreviewPush] = useState<{ projectId: string; pushId: string } | null>(null);

  const monthKey = format(visibleMonth, 'yyyy-MM');
  const { data: summary } = useQuery({
    queryKey: ['pushes-global-scheduled-summary', monthKey],
    queryFn: async () => (await api.get<{ date: string; count: number }[]>('/pushes/scheduled-summary', { params: { month: monthKey } })).data,
  });
  const counts = new Map((summary ?? []).map((s) => [s.date, s.count]));

  const dateKey = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
  const { data: dayItems, isFetching: dayLoading } = useQuery({
    queryKey: ['pushes-global-scheduled-day', dateKey],
    queryFn: async () => (await api.get<DayScheduleItem[]>('/pushes/scheduled-day', { params: { date: dateKey } })).data,
    enabled: !!dateKey,
  });

  // Два таба (запрос пользователя 2026-08-04: "показывай только те что в ожидании... сделай и
  // таб для тех что уже были, подгружай только когда нажимают") — pending загружается сразу,
  // history — отдельный запрос с enabled: listTab==='history', первый клик и запускает загрузку.
  const [listTab, setListTab] = useState<'pending' | 'history'>('pending');
  const { data: pendingPushes } = useQuery({
    queryKey: ['pushes-global-all', 'pending'],
    queryFn: async () => (await api.get<PushRow[]>('/pushes', { params: { scope: 'pending' } })).data,
  });
  const { data: historyPushes, isFetching: historyLoading } = useQuery({
    queryKey: ['pushes-global-all', 'history'],
    queryFn: async () => (await api.get<PushRow[]>('/pushes', { params: { scope: 'history' } })).data,
    enabled: listTab === 'history',
  });
  const allPushes = listTab === 'pending' ? pendingPushes : historyPushes;

  // Действия прямо на этой странице (запрос пользователя 2026-08-05) — см. полный комментарий в
  // classic-версии (apps/web/src/app/(dashboard)/pushes-calendar/page.tsx).
  const invalidatePushLists = () => {
    queryClient.invalidateQueries({ queryKey: ['pushes-global-all'] });
    queryClient.invalidateQueries({ queryKey: ['pushes-global-scheduled-summary'] });
    queryClient.invalidateQueries({ queryKey: ['pushes-global-scheduled-day'] });
  };
  const cancelPush = useMutation({
    mutationFn: ({ projectId, pushId }: { projectId: string; pushId: string }) => api.delete(`/projects/${projectId}/pushes/${pushId}`),
    onSuccess: invalidatePushLists,
  });
  const duplicatePush = useMutation({
    mutationFn: ({ projectId, pushId }: { projectId: string; pushId: string }) =>
      api.post<{ id: string }>(`/projects/${projectId}/pushes/${pushId}/duplicate`),
    onSuccess: (res, vars) => {
      invalidatePushLists();
      router.push(`/projects/${vars.projectId}/pushes/${res.data.id}/edit`);
    },
  });

  // Без ограничения ширины (запрос пользователя 2026-07-31: "увеличь его на всю ширину для
  // удобства") — та же конвенция, что и у остальных полноширинных страниц дашборда;
  // DayScheduleList уже flex-1, растягивается сама, календарь-сетка остаётся своего фикс. размера.
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">
            <Send className="h-6 w-6" /> Рассылки
          </h1>
          <p className="mt-1.5 text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Все запланированные рассылки по всем проектам сразу</p>
        </div>
        <StudioLinkButton variant="primary" icon={Plus} href="/pushes/new">
          Создать рассылку
        </StudioLinkButton>
      </div>

      <div className={`${STUDIO_CARD} flex flex-wrap items-start gap-6 p-6`}>
        <CalendarGrid
          visibleMonth={visibleMonth}
          onMonthChange={setVisibleMonth}
          counts={counts}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
        <DayScheduleList date={selectedDate} items={dayItems} isLoading={dayLoading} showProject />
      </div>

      <div className="inline-flex rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-1 gap-0.5">
        <button
          type="button"
          onClick={() => setListTab('pending')}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            listTab === 'pending'
              ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
              : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
          }`}
        >
          В ожидании
        </button>
        <button
          type="button"
          onClick={() => setListTab('history')}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            listTab === 'history'
              ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
              : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
          }`}
        >
          Отправлено
        </button>
      </div>

      <div className={`${STUDIO_CARD} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
              <th className="px-5 py-3 font-medium">Статус</th>
              <th className="px-5 py-3 font-medium">Название</th>
              <th className="px-5 py-3 font-medium">Проект</th>
              <th className="px-5 py-3 font-medium">Дата</th>
              <th className="px-5 py-3 font-medium text-right">Аудитория</th>
              <th className="px-5 py-3 font-medium text-right">Отправлено</th>
              <th className="px-5 py-3 font-medium text-right">Ошибки</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
            {listTab === 'history' && historyLoading && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-[#5F6B7A] dark:text-[#92A0AF]">
                  Загрузка...
                </td>
              </tr>
            )}
            {allPushes?.map((push) => (
              <tr
                key={push.id}
                className="cursor-pointer hover:bg-[#F3F5F8] dark:hover:bg-white/5"
                onClick={() => setPreviewPush({ projectId: push.project.id, pushId: push.id })}
              >
                <td className="px-5 py-3">
                  <StudioPill hue={STATUS_HUE[push.status] ?? 'slate'}>{push.status}</StudioPill>
                </td>
                <td className="px-5 py-3 font-medium text-[#131A24] dark:text-[#E9EDF3]">{push.name}</td>
                <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                  <Link href={`/projects/${push.project.id}/pushes`} className="text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline">
                    {push.project.name}
                  </Link>
                </td>
                <td className="px-5 py-3 text-[#5F6B7A] dark:text-[#92A0AF] whitespace-nowrap">
                  {push.sentAt
                    ? format(new Date(push.sentAt), 'd MMM HH:mm')
                    : push.scheduledAt
                      ? format(new Date(push.scheduledAt), 'd MMM HH:mm')
                      : '—'}
                </td>
                <td className="px-5 py-3 text-right font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{push.audienceReachable}</td>
                <td className="px-5 py-3 text-right font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{push.sentCount}</td>
                <td
                  className={`px-5 py-3 text-right font-mono tabular-nums ${push.failedCount > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-[#131A24] dark:text-[#E9EDF3]'}`}
                >
                  {push.failedCount}
                </td>
                <td className="px-5 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <div className="inline-flex items-center gap-3">
                    {(push.status === 'DRAFT' || push.status === 'SCHEDULED') && hasPermission(user, push.project.id, 'PUSHES_CREATE') && (
                      <Link
                        href={`/projects/${push.project.id}/pushes/${push.id}/edit`}
                        className="inline-flex items-center gap-1 text-xs text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] underline-offset-2 hover:underline"
                      >
                        <Pencil className="w-3 h-3" /> Изменить
                      </Link>
                    )}
                    {hasPermission(user, push.project.id, 'PUSHES_CREATE') && (
                      <button
                        type="button"
                        onClick={() => duplicatePush.mutate({ projectId: push.project.id, pushId: push.id })}
                        disabled={duplicatePush.isPending}
                        className="inline-flex items-center gap-1 text-xs text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        <Copy className="w-3 h-3" /> Копировать
                      </button>
                    )}
                    {(push.status === 'DRAFT' || push.status === 'SCHEDULED') && hasPermission(user, push.project.id, 'PUSHES_DELETE') && (
                      <button
                        type="button"
                        onClick={() => cancelPush.mutate({ projectId: push.project.id, pushId: push.id })}
                        className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] underline-offset-2 hover:underline"
                      >
                        Отменить
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {allPushes?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-[#5F6B7A] dark:text-[#92A0AF]">
                  Рассылок пока нет.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {previewPush && (
        <PushPreviewDialog key={previewPush.pushId} projectId={previewPush.projectId} pushId={previewPush.pushId} onClose={() => setPreviewPush(null)} />
      )}
    </div>
  );
}
