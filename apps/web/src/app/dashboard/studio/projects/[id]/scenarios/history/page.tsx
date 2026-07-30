'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import { api } from '@/lib/api';
import { AB_TEST_METRIC_ROWS, ScenarioAbTestGroupListItem, TRIGGER_TYPE_LABEL } from '@/lib/scenarios';
import { STUDIO_CARD } from '../../../../ui';

interface ProjectChannel {
  channel: { id: string } | null;
}

function groupTitle(g: ScenarioAbTestGroupListItem): string {
  if (!g.triggerType) return 'Сценарий удалён';
  if (g.triggerType === 'COMMAND') return `/${g.command}`;
  return TRIGGER_TYPE_LABEL[g.triggerType];
}

// Studio-версия истории A/B-тестов сценариев (запрос пользователя 2026-07-30: "добей остальные
// оставшиеся страницы") — логика 1:1 с классической. Ссылка "К сценарию →" по-прежнему ведёт на
// классический редактор сценария — своей Studio-версии у него пока нет.
export default function StudioScenarioAbTestHistoryPage() {
  const { id: projectId } = useParams<{ id: string }>();

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.get<ProjectChannel>(`/projects/${projectId}`)).data,
  });
  const channelId = project?.channel?.id;

  const { data: groups, isLoading } = useQuery({
    queryKey: ['channel', channelId, 'scenario-ab-test-groups'],
    queryFn: async () => (await api.get<ScenarioAbTestGroupListItem[]>(`/channels/${channelId}/scenarios/ab-test-groups`)).data,
    enabled: !!channelId,
  });

  const endedGroups = (groups ?? []).filter((g) => g.endedAt);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/studio/projects/${projectId}/scenarios`}
          className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Сценарии
        </Link>
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">История A/B-тестов сценариев</h1>
      </div>

      {isLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {!isLoading && endedGroups.length === 0 && (
        <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>Завершённых тестов пока нет.</div>
      )}

      <div className="space-y-2">
        {endedGroups.map((g) => {
          const variants = g.resultsSnapshot ?? [];
          return (
            <div key={g.id} className={`${STUDIO_CARD} p-4 space-y-2`}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium truncate flex items-center gap-1.5 text-[#131A24] dark:text-[#E9EDF3]">
                    <FlaskConical className="w-4 h-4 shrink-0 text-[#5F6B7A] dark:text-[#92A0AF]" /> {groupTitle(g)}
                  </p>
                  <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                    {format(new Date(g.createdAt), 'd MMM yyyy')} — {format(new Date(g.endedAt!), 'd MMM yyyy')}
                  </p>
                </div>
                {g.primaryScenarioId && (
                  <Link
                    href={`/dashboard/studio/projects/${projectId}/scenarios/${g.primaryScenarioId}`}
                    className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:underline shrink-0"
                  >
                    К сценарию →
                  </Link>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="text-sm w-full min-w-[500px]">
                  <thead>
                    <tr className="text-left text-[#5F6B7A] dark:text-[#92A0AF]">
                      <th className="pr-4 py-1">Вариант</th>
                      <th className="pr-4 py-1">%</th>
                      <th className="pr-4 py-1">Получили</th>
                      {AB_TEST_METRIC_ROWS.map((row) => (
                        <th key={row.key} className="pr-4 py-1">
                          {row.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((v, i) => (
                      <tr key={v.scenarioId} className="border-t border-[#DCE1E8] dark:border-white/10">
                        <td className="pr-4 py-1 font-medium text-[#131A24] dark:text-[#E9EDF3]">Вариант {String.fromCharCode(65 + i)}</td>
                        <td className="pr-4 py-1 text-[#131A24] dark:text-[#E9EDF3]">{v.weight}%</td>
                        <td className="pr-4 py-1 text-[#131A24] dark:text-[#E9EDF3]">{v.received}</td>
                        {AB_TEST_METRIC_ROWS.map((row) => (
                          <td key={row.key} className="pr-4 py-1 text-[#131A24] dark:text-[#E9EDF3]">
                            {v[row.key]} <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">({v[`${row.key}Pct` as const]}%)</span>
                          </td>
                        ))}
                      </tr>
                    ))}
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
