'use client';

// Завершённые A/B-тесты сценариев — вынесены на отдельную страницу (запрос пользователя
// 2026-07-25: "завершенные тесты не показывай так, на отдельной странице лучше"), тот же
// принцип, что уже есть у истории A/B/n-тестов лендингов (/landings/history). Read-only —
// цифры застыли на момент остановки теста (BotScenariosService.endAbTest), не пересчитываются.

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import { api } from '@/lib/api';
import { AB_TEST_METRIC_ROWS, ScenarioAbTestGroupListItem, TRIGGER_TYPE_LABEL } from '@/lib/scenarios';
import { Card, CardContent } from '@/components/ui/card';

interface ProjectChannel {
  channel: { id: string } | null;
}

function groupTitle(g: ScenarioAbTestGroupListItem): string {
  if (!g.triggerType) return 'Сценарий удалён';
  if (g.triggerType === 'COMMAND') return `/${g.command}`;
  return TRIGGER_TYPE_LABEL[g.triggerType];
}

export default function ScenarioAbTestHistoryPage() {
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
          href={`/projects/${projectId}/scenarios`}
          className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Сценарии
        </Link>
        <h1 className="text-2xl font-bold">История A/B-тестов сценариев</h1>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}

      {!isLoading && endedGroups.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">Завершённых тестов пока нет.</CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {endedGroups.map((g) => {
          const variants = g.resultsSnapshot ?? [];
          return (
            <Card key={g.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium truncate flex items-center gap-1.5">
                      <FlaskConical className="w-4 h-4 shrink-0 text-muted-foreground" /> {groupTitle(g)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(g.createdAt), 'd MMM yyyy')} — {format(new Date(g.endedAt!), 'd MMM yyyy')}
                    </p>
                  </div>
                  {/* Ведёт в редактор сценария, не на /ab-test — после завершения теста
                      сценарии больше не связаны с группой (см. BotScenariosService.endAbTest),
                      сравнительная статистика по ней уже вся здесь, в таблице ниже. */}
                  {g.primaryScenarioId && (
                    <Link
                      href={`/projects/${projectId}/scenarios/${g.primaryScenarioId}`}
                      className="text-sm text-muted-foreground hover:underline shrink-0"
                    >
                      К сценарию →
                    </Link>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="text-sm w-full min-w-[500px]">
                    <thead>
                      <tr className="text-left text-muted-foreground">
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
                        <tr key={v.scenarioId} className="border-t">
                          <td className="pr-4 py-1 font-medium">Вариант {String.fromCharCode(65 + i)}</td>
                          <td className="pr-4 py-1">{v.weight}%</td>
                          <td className="pr-4 py-1">{v.received}</td>
                          {AB_TEST_METRIC_ROWS.map((row) => (
                            <td key={row.key} className="pr-4 py-1">
                              {v[row.key]} <span className="text-xs text-muted-foreground">({v[`${row.key}Pct` as const]}%)</span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
