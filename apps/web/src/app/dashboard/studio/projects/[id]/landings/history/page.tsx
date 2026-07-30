'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { AbTestGroupItem, groupAutoLabel } from '@/lib/landings';
import { STUDIO_CARD } from '../../../../ui';

// Studio-версия истории A/B/n-тестов лендингов (запрос пользователя 2026-07-30: "добей остальные
// оставшиеся страницы") — логика 1:1 с классической. Клик по карточке ведёт на классическую
// страницу группы A/B-теста — своей Studio-версии у неё пока нет.
export default function StudioAbTestHistoryPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: abTestGroups, isLoading } = useQuery({
    queryKey: ['ab-test-groups', projectId],
    queryFn: async () => (await api.get<AbTestGroupItem[]>(`/projects/${projectId}/ab-test-groups`)).data,
  });

  const endedGroups = (abTestGroups ?? []).filter((g) => g.endedAt);

  const deleteHistory = useMutation({
    mutationFn: (groupId: string) => api.delete(`/ab-test-groups/${groupId}/history`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ab-test-groups', projectId] }),
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/studio/projects/${projectId}/landings`}
          className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Лендинги
        </Link>
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">История A/B/n-тестов</h1>
      </div>

      {isLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {!isLoading && endedGroups.length === 0 && (
        <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>Завершённых тестов пока нет.</div>
      )}

      <div className="space-y-2">
        {endedGroups.map((g) => {
          const members = g.resultsSnapshot ?? [];
          const totals = members.reduce(
            (acc, m) => ({
              pageViews: acc.pageViews + m.pageViews,
              leads: acc.leads + m.leads,
              subscribes: acc.subscribes + m.subscribes,
              dialogues: acc.dialogues + m.dialogues,
            }),
            { pageViews: 0, leads: 0, subscribes: 0, dialogues: 0 },
          );
          return (
            <div
              key={g.id}
              onClick={() => router.push(`/dashboard/studio/projects/${projectId}/landings/groups/${g.id}`)}
              className={`${STUDIO_CARD} p-4 space-y-2 cursor-pointer hover:opacity-90 transition-opacity`}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium truncate text-[#131A24] dark:text-[#E9EDF3]">{g.name || groupAutoLabel(g)}</p>
                  <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                    {format(new Date(g.createdAt), 'd MMM yyyy')} — {format(new Date(g.endedAt!), 'd MMM yyyy')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteHistory.mutate(g.id);
                  }}
                  disabled={deleteHistory.isPending}
                  className="text-[#5F6B7A] dark:text-[#92A0AF] hover:text-red-600 dark:hover:text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="text-sm w-full">
                  <thead>
                    <tr className="text-left text-[#5F6B7A] dark:text-[#92A0AF]">
                      <th className="pr-4 py-1">Вариант</th>
                      <th className="pr-4 py-1">%</th>
                      <th className="pr-4 py-1">Просмотров</th>
                      <th className="pr-4 py-1">Кликов</th>
                      <th className="pr-4 py-1">Подписчиков</th>
                      <th className="py-1">Диалогов</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.landingId} className="border-t border-[#DCE1E8] dark:border-white/10">
                        <td className="pr-4 py-1 font-medium text-[#131A24] dark:text-[#E9EDF3]">{m.name}</td>
                        <td className="pr-4 py-1 text-[#131A24] dark:text-[#E9EDF3]">{m.weight ?? 0}%</td>
                        <td className="pr-4 py-1 text-[#131A24] dark:text-[#E9EDF3]">{m.pageViews}</td>
                        <td className="pr-4 py-1 text-[#131A24] dark:text-[#E9EDF3]">{m.leads}</td>
                        <td className="pr-4 py-1 text-[#131A24] dark:text-[#E9EDF3]">{m.subscribes}</td>
                        <td className="py-1 text-[#131A24] dark:text-[#E9EDF3]">{m.dialogues}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-[#DCE1E8] dark:border-white/10 font-semibold">
                      <td className="pr-4 py-1 text-[#131A24] dark:text-[#E9EDF3]">Итого</td>
                      <td className="pr-4 py-1" />
                      <td className="pr-4 py-1 text-[#131A24] dark:text-[#E9EDF3]">{totals.pageViews}</td>
                      <td className="pr-4 py-1 text-[#131A24] dark:text-[#E9EDF3]">{totals.leads}</td>
                      <td className="pr-4 py-1 text-[#131A24] dark:text-[#E9EDF3]">{totals.subscribes}</td>
                      <td className="py-1 text-[#131A24] dark:text-[#E9EDF3]">{totals.dialogues}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
