'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FlaskConical, Settings } from 'lucide-react';
import { api } from '@/lib/api';
import { AB_TEST_METRIC_ROWS, AbTestStats, BotScenarioDetail, TRIGGER_TYPE_ICON, scenarioTitle } from '@/lib/scenarios';
import { STUDIO_CARD, StudioPill } from '../../../../../ui';

interface ProjectChannel {
  channel: { id: string } | null;
}

// Studio-версия сравнительной статистики A/B-теста сценариев (запрос пользователя 2026-07-30:
// "добей остальные оставшиеся страницы") — логика 1:1 с классической. Ссылки "К сценарию"/
// "настроить" ведут на Studio-редактор сценария (появился позже в тот же день).
export default function StudioScenarioAbTestStatsPage() {
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
          className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> К сценарию
        </Link>
        <h1 className="text-xl font-semibold truncate flex items-center gap-2 text-[#131A24] dark:text-[#E9EDF3]">
          {TriggerIcon && <TriggerIcon className="w-5 h-5 shrink-0 text-[#5F6B7A] dark:text-[#92A0AF]" />}
          <FlaskConical className="w-5 h-5 shrink-0 text-[#5F6B7A] dark:text-[#92A0AF]" />
          {scenario && !scenario.isAbTestVariant ? scenarioTitle(scenario) : 'A/B-тест'} — сравнение вариантов
          {abStats?.endedAt && <StudioPill hue="slate">Завершён</StudioPill>}
        </h1>
      </div>

      {isLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {abStats && (
        <div className={`${STUDIO_CARD} p-4 overflow-x-auto`}>
          <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] mb-4">
            Все метрики, кроме «Получили сообщение», — снимок текущего состояния клиентов, получивших вариант (в проекте нет трекинга
            прочтения конкретных сообщений бота), проценты считаются от числа получателей с известной карточкой клиента.
          </p>
          <table className="w-full text-sm border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b border-[#DCE1E8] dark:border-white/10">
                <th className="text-left py-2 pr-4 font-medium text-[#5F6B7A] dark:text-[#92A0AF]">Метрика</th>
                {abStats.variants.map((v, i) => (
                  <th key={v.scenarioId} className="text-left py-2 px-4 font-medium text-[#131A24] dark:text-[#E9EDF3]">
                    <div className="flex items-center gap-2">
                      {variantLabels(i)}
                      {!v.isActive && <StudioPill hue="slate">выкл</StudioPill>}
                    </div>
                    <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] font-normal mt-0.5">
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
              <tr className="border-b border-[#DCE1E8] dark:border-white/10">
                <td className="py-2 pr-4 text-[#5F6B7A] dark:text-[#92A0AF]">Получили сообщение</td>
                {abStats.variants.map((v) => (
                  <td key={v.scenarioId} className="py-2 px-4 font-medium text-[#131A24] dark:text-[#E9EDF3]">
                    {v.received}
                    <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] ml-1">({v.resolvedCount} с карточкой клиента)</span>
                  </td>
                ))}
              </tr>
              {AB_TEST_METRIC_ROWS.map((row) => {
                const maxPct = Math.max(...abStats.variants.map((v) => v[`${row.key}Pct` as const]));
                return (
                  <tr key={row.key} className="border-b border-[#DCE1E8] dark:border-white/10 last:border-0">
                    <td className="py-2 pr-4 text-[#5F6B7A] dark:text-[#92A0AF]">{row.label}</td>
                    {abStats.variants.map((v) => {
                      const count = v[row.key];
                      const pct = v[`${row.key}Pct` as const];
                      const isMax = pct === maxPct && maxPct > 0;
                      return (
                        <td key={v.scenarioId} className={isMax ? 'py-2 px-4 font-semibold text-[#1F7A6C] dark:text-[#6FCBBA]' : 'py-2 px-4 text-[#131A24] dark:text-[#E9EDF3]'}>
                          {count} <span className="text-xs opacity-70">({pct}%)</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !abStats && (
        <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>У этого сценария нет A/B-теста.</div>
      )}
    </div>
  );
}
