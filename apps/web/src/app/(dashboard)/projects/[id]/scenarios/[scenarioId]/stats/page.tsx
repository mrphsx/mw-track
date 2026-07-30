'use client';

// Статистика сценария (запрос пользователя 2026-07-25: "кнопка которая ведет на статистику
// сценария, и там кроме обычной статистики список клиентов которые прошли/в ожидании/ошибка +
// дата отправки"). Счётчики — те же 4 статуса, что и на карточке в списке, список клиентов —
// постранично, с фильтром по статусу (GET .../scenarios/:id/stats?status=&limit=&offset=).

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, CheckCircle2, Clock, TriangleAlert, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { BotScenarioDetail, RUN_STATUS_LABEL, ScenarioRunStatus, ScenarioStats, TRIGGER_TYPE_ICON, scenarioTitle } from '@/lib/scenarios';
import { StatsCard } from '@/components/shared/stats-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const PAGE_SIZE = 50;

const STATUS_FILTER_OPTIONS: { value: 'ALL' | ScenarioRunStatus; label: string }[] = [
  { value: 'ALL', label: 'Все статусы' },
  { value: 'COMPLETED', label: 'Успешно' },
  { value: 'ACTIVE', label: 'В ожидании' },
  { value: 'FAILED', label: 'Ошибка' },
  { value: 'EXITED', label: 'Прервано' },
];

const STATUS_BADGE: Record<ScenarioRunStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  COMPLETED: { label: 'Успешно', className: 'text-green-600 dark:text-green-400', icon: CheckCircle2 },
  ACTIVE: { label: 'В ожидании', className: 'text-muted-foreground', icon: Clock },
  FAILED: { label: 'Ошибка', className: 'text-red-600 dark:text-red-400', icon: XCircle },
  EXITED: { label: 'Прервано', className: 'text-amber-600 dark:text-amber-400', icon: TriangleAlert },
};

interface ProjectChannel {
  channel: { id: string } | null;
}

export default function ScenarioStatsPage() {
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
          className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> К сценарию
        </Link>
        <h1 className="text-xl font-semibold truncate flex items-center gap-2">
          {TriggerIcon && <TriggerIcon className="w-5 h-5 shrink-0 text-muted-foreground" />}
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

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-medium">Клиенты</h2>
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

          {isLoading && !stats && <p className="text-sm text-muted-foreground">Загрузка...</p>}

          {stats && stats.runs.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">Пока никто не проходил.</p>}

          {stats && stats.runs.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Дата отправки</TableHead>
                    <TableHead>Завершён</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.runs.map((run) => {
                    const badge = STATUS_BADGE[run.status];
                    const BadgeIcon = badge.icon;
                    return (
                      <TableRow key={run.id}>
                        <TableCell className="min-w-0">
                          <div className="truncate">{run.clientName || (run.clientUsername ? `@${run.clientUsername}` : run.tgUserId)}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`inline-flex items-center gap-1 ${badge.className}`}>
                            <BadgeIcon className="w-3 h-3" /> {badge.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {format(new Date(run.startedAt), 'd MMM yyyy, HH:mm')}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {run.completedAt ? format(new Date(run.completedAt), 'd MMM yyyy, HH:mm') : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    Страница {page + 1} из {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                      Назад
                    </Button>
                    <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
                      Вперёд
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
