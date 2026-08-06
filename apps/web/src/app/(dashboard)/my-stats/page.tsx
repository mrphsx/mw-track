'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, ShoppingCart, DollarSign } from 'lucide-react';
import { api } from '@/lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PeriodSelector, PeriodValue } from '@/components/shared/period-selector';
import { StatsCard } from '@/components/shared/stats-card';

interface ProjectSummary {
  id: string;
  name: string;
}

interface MyStats {
  totalClients: number;
  myPurchasesCount: number;
  myPurchasesRevenue: number;
}

// Персональная статистика Operator-а (запрос пользователя 2026-07-30: "своя страница общей
// статистики именно под него, сколько он сделал депозитов, сколько клиентов на его именно
// проекте") — myPurchasesCount/myPurchasesRevenue считаются по Purchase.registeredBy = этот
// пользователь, НЕ по всем клиентам проекта (см. ClientsRepository.getMyStats).
export default function MyStatsPage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [periodValue, setPeriodValue] = useState<PeriodValue>({ period: '30d' });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });

  useEffect(() => {
    if (!projectId && projects?.length) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const periodReady = periodValue.period !== 'custom' || (!!periodValue.from && !!periodValue.to);
  const periodParams =
    periodValue.period === 'custom' ? { period: periodValue.period, from: periodValue.from, to: periodValue.to } : { period: periodValue.period };

  const { data: stats } = useQuery({
    queryKey: ['my-stats', projectId, periodValue],
    queryFn: async () => (await api.get<MyStats>(`/projects/${projectId}/clients/my-stats`, { params: periodParams })).data,
    enabled: !!projectId && periodReady,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Моя статистика</h1>
        {projects && projects.length > 1 && (
          <Select value={projectId ?? undefined} onValueChange={setProjectId}>
            <SelectTrigger className="w-56">
              {/* Base UI Select.Value без children рендерит сырой value (id) — см. тот же
                  фикс в my-clients/page.tsx. */}
              <SelectValue>{(v: string) => projects.find((p) => p.id === v)?.name ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {projects && projects.length > 0 && (
        <div className="flex items-center flex-wrap gap-2">
          <span className="text-xs text-muted-foreground">Доступные проекты:</span>
          {projects.map((p) => (
            <Badge key={p.id} variant={p.id === projectId ? 'default' : 'secondary'}>
              {p.name}
            </Badge>
          ))}
        </div>
      )}

      <PeriodSelector value={periodValue} onChange={setPeriodValue} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard label="Клиентов на проекте" value={stats?.totalClients ?? '—'} icon={Users} />
        <StatsCard
          label="Депозитов зарегистрировано мной"
          value={stats?.myPurchasesCount ?? '—'}
          icon={ShoppingCart}
          hint="За выбранный период"
        />
        <StatsCard
          label="Сумма депозитов"
          value={stats ? `$${stats.myPurchasesRevenue.toFixed(2)}` : '—'}
          icon={DollarSign}
          hint="За выбранный период"
        />
      </div>
    </div>
  );
}
