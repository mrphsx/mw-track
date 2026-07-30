'use client';

// Сравнительная статистика A/B-теста сценариев (запрос пользователя 2026-07-25) — таблица
// "метрика × вариант", проще, чем сравнение лендингов (там график по дням, здесь — снимок
// текущего состояния клиентов, получивших вариант, без временного ряда: движок сценариев не
// пишет историю ответов на конкретные сообщения бота, только BotScenarioRun.status).

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FlaskConical, Settings } from 'lucide-react';
import { api } from '@/lib/api';
import { AB_TEST_METRIC_ROWS, AbTestStats, BotScenarioDetail, TRIGGER_TYPE_ICON, scenarioTitle } from '@/lib/scenarios';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

interface ProjectChannel {
  channel: { id: string } | null;
}

export default function ScenarioAbTestStatsPage() {
  const { id: projectId, scenarioId } = useParams<{ id: string; scenarioId: string }>();

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.get<ProjectChannel>(`/projects/${projectId}`)).data,
  });
  const channelId = project?.channel?.id;

  const { data: scenario } = useQuery({
    queryKey: ['channel', channelId, 'scenarios', scenarioId],
    queryFn: async () => (await api.get<BotScenarioDetail>(`/channels/${channelId}/scenarios/${scenarioId}`)).data,
    enabled: !!channelId,
  });

  const { data: abStats, isLoading } = useQuery({
    queryKey: ['channel', channelId, 'scenarios', scenarioId, 'ab-test'],
    queryFn: async () => (await api.get<AbTestStats>(`/channels/${channelId}/scenarios/${scenarioId}/ab-test/stats`)).data,
    enabled: !!channelId,
  });

  const TriggerIcon = scenario ? TRIGGER_TYPE_ICON[scenario.triggerType] : null;
  const variantLabels = (i: number) => `Вариант ${String.fromCharCode(65 + i)}`;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/scenarios/${scenarioId}`}
          className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> К сценарию
        </Link>
        <h1 className="text-xl font-semibold truncate flex items-center gap-2">
          {TriggerIcon && <TriggerIcon className="w-5 h-5 shrink-0 text-muted-foreground" />}
          <FlaskConical className="w-5 h-5 shrink-0 text-muted-foreground" />
          {scenario && !scenario.isAbTestVariant ? scenarioTitle(scenario) : 'A/B-тест'} — сравнение вариантов
          {abStats?.endedAt && <Badge variant="outline">Завершён</Badge>}
        </h1>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}

      {abStats && (
        <Card>
          <CardContent className="p-4 overflow-x-auto">
            <p className="text-xs text-muted-foreground mb-4">
              Все метрики, кроме «Получили сообщение», — снимок текущего состояния клиентов, получивших вариант (в проекте нет трекинга
              прочтения конкретных сообщений бота), проценты считаются от числа получателей с известной карточкой клиента.
            </p>
            <table className="w-full text-sm border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Метрика</th>
                  {abStats.variants.map((v, i) => (
                    <th key={v.scenarioId} className="text-left py-2 px-4 font-medium">
                      <div className="flex items-center gap-2">
                        {variantLabels(i)}
                        {!v.isActive && (
                          <Badge variant="outline" className="text-xs">
                            выкл
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground font-normal mt-0.5">
                        вес {v.weight}%
                        {v.scenarioId !== scenarioId && (
                          <Link href={`/projects/${projectId}/scenarios/${v.scenarioId}`} className="ml-2 inline-flex items-center gap-0.5 hover:underline">
                            <Settings className="w-3 h-3" /> настроить
                          </Link>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="py-2 pr-4 text-muted-foreground">Получили сообщение</td>
                  {abStats.variants.map((v) => (
                    <td key={v.scenarioId} className="py-2 px-4 font-medium">
                      {v.received}
                      <span className="text-xs text-muted-foreground ml-1">({v.resolvedCount} с карточкой клиента)</span>
                    </td>
                  ))}
                </tr>
                {AB_TEST_METRIC_ROWS.map((row) => {
                  const maxPct = Math.max(...abStats.variants.map((v) => v[`${row.key}Pct` as const]));
                  return (
                    <tr key={row.key} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-muted-foreground">{row.label}</td>
                      {abStats.variants.map((v) => {
                        const count = v[row.key];
                        const pct = v[`${row.key}Pct` as const];
                        const isMax = pct === maxPct && maxPct > 0;
                        return (
                          <td key={v.scenarioId} className={isMax ? 'py-2 px-4 font-semibold text-green-600 dark:text-green-400' : 'py-2 px-4'}>
                            {count} <span className="text-xs opacity-70">({pct}%)</span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {!isLoading && !abStats && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">У этого сценария нет A/B-теста.</CardContent>
        </Card>
      )}
    </div>
  );
}
