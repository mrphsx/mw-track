'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, CheckCircle2, Clock, TriangleAlert, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { BotScenarioDetail, RUN_STATUS_LABEL, ScenarioRunStatus, ScenarioStats, TRIGGER_TYPE_ICON, scenarioTitle } from '@/lib/scenarios';
import { StatsCard } from '@/components/shared/stats-card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { STUDIO_CARD, StudioLinkButton } from '../../../../../ui';

const PAGE_SIZE = 50;

const STATUS_FILTER_OPTIONS: { value: 'ALL' | ScenarioRunStatus; label: string }[] = [
  { value: 'ALL', label: 'Все статусы' },
  { value: 'COMPLETED', label: 'Успешно' },
  { value: 'ACTIVE', label: 'В ожидании' },
  { value: 'FAILED', label: 'Ошибка' },
  { value: 'EXITED', label: 'Прервано' },
];

const STATUS_BADGE: Record<ScenarioRunStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  COMPLETED: { label: 'Успешно', className: 'text-[#1F7A6C] dark:text-[#6FCBBA]', icon: CheckCircle2 },
  ACTIVE: { label: 'В ожидании', className: 'text-[#5F6B7A] dark:text-[#92A0AF]', icon: Clock },
  FAILED: { label: 'Ошибка', className: 'text-red-600 dark:text-red-400', icon: XCircle },
  EXITED: { label: 'Прервано', className: 'text-[#B45309] dark:text-[#FBBF24]', icon: TriangleAlert },
};

interface ProjectChannel {
  channel: { id: string } | null;
}

// Studio-версия статистики сценария (запрос пользователя 2026-07-30: "добей остальные
// оставшиеся страницы") — логика 1:1 с классической. StatsCard переиспользован без изменений.
export default function StudioScenarioStatsPage() {
  const { id: projectId, scenarioId } = useParams<{ id: string; scenarioId: string }>();
  const [statusFilter, setStatusFilter] = useState<'ALL' | ScenarioRunStatus>('ALL');
  const [page, setPage] = useState(0);

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

  const { data: stats, isLoading } = useQuery({
    queryKey: ['channel', channelId, 'scenarios', scenarioId, 'stats', statusFilter, page],
    queryFn: async () =>
      (
        await api.get<ScenarioStats>(`/channels/${channelId}/scenarios/${scenarioId}/stats`, {
          params: { status: statusFilter === 'ALL' ? undefined : statusFilter, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
        })
      ).data,
    enabled: !!channelId,
    placeholderData: (prev) => prev,
  });

  const TriggerIcon = scenario ? TRIGGER_TYPE_ICON[scenario.triggerType] : null;
  const totalPages = stats ? Math.ceil(stats.total / PAGE_SIZE) : 0;

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
          {scenario ? scenarioTitle(scenario) : 'Загрузка...'} — статистика
        </h1>
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard label={RUN_STATUS_LABEL.completed} value={stats.counts.completed} icon={CheckCircle2} />
          <StatsCard label={RUN_STATUS_LABEL.active} value={stats.counts.active} icon={Clock} />
          <StatsCard label={RUN_STATUS_LABEL.failed} value={stats.counts.failed} icon={XCircle} />
          <StatsCard label={RUN_STATUS_LABEL.exited} value={stats.counts.exited} icon={TriangleAlert} />
        </div>
      )}

      <div className={`${STUDIO_CARD} p-5 space-y-4`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-medium text-[#131A24] dark:text-[#E9EDF3]">Клиенты</h2>
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              if (!v) return;
              setStatusFilter(v as 'ALL' | ScenarioRunStatus);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading && !stats && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

        {stats && stats.runs.length === 0 && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] py-6 text-center">Пока никто не проходил.</p>}

        {stats && stats.runs.length > 0 && (
          <>
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                    <th className="px-5 py-2 font-medium">Клиент</th>
                    <th className="px-5 py-2 font-medium">Статус</th>
                    <th className="px-5 py-2 font-medium">Дата отправки</th>
                    <th className="px-5 py-2 font-medium">Завершён</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
                  {stats.runs.map((run) => {
                    const badge = STATUS_BADGE[run.status];
                    const BadgeIcon = badge.icon;
                    return (
                      <tr key={run.id}>
                        <td className="px-5 py-2 min-w-0">
                          <div className="truncate text-[#131A24] dark:text-[#E9EDF3]">{run.clientName || (run.clientUsername ? `@${run.clientUsername}` : run.tgUserId)}</div>
                        </td>
                        <td className="px-5 py-2">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium ${badge.className}`}>
                            <BadgeIcon className="w-3 h-3" /> {badge.label}
                          </span>
                        </td>
                        <td className="px-5 py-2 text-sm text-[#5F6B7A] dark:text-[#92A0AF] whitespace-nowrap">{format(new Date(run.startedAt), 'd MMM yyyy, HH:mm')}</td>
                        <td className="px-5 py-2 text-sm text-[#5F6B7A] dark:text-[#92A0AF] whitespace-nowrap">
                          {run.completedAt ? format(new Date(run.completedAt), 'd MMM yyyy, HH:mm') : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
                <span>
                  Страница {page + 1} из {totalPages}
                </span>
                <div className="flex gap-2">
                  <StudioLinkButton size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    Назад
                  </StudioLinkButton>
                  <StudioLinkButton size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Вперёд
                  </StudioLinkButton>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
