'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, ShoppingCart, DollarSign } from 'lucide-react';
import { api } from '@/lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PeriodSelector, PeriodValue } from '@/components/shared/period-selector';
import { STUDIO_CARD, StudioPill } from '../ui';

interface ProjectSummary {
  id: string;
  name: string;
}

interface MyStats {
  totalClients: number;
  myPurchasesCount: number;
  myPurchasesRevenue: number;
}

// Studio-версия персональной статистики Operator-а — см. classic (dashboard)/my-stats для
// полного комментария (запрос пользователя 2026-07-30). myPurchasesCount/Revenue считаются по
// Purchase.registeredBy = этот пользователь, не по всем клиентам проекта.
export default function StudioMyStatsPage() {
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
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Моя статистика</h1>
        {projects && projects.length > 1 && (
          <Select value={projectId ?? undefined} onValueChange={setProjectId}>
            <SelectTrigger className="w-56 rounded-lg">
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
          <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Доступные проекты:</span>
          {projects.map((p) => (
            <StudioPill key={p.id} hue={p.id === projectId ? 'amber' : undefined}>
              {p.name}
            </StudioPill>
          ))}
        </div>
      )}

      <PeriodSelector value={periodValue} onChange={setPeriodValue} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile label="Клиентов на проекте" value={stats?.totalClients ?? '—'} icon={Users} />
        <StatTile label="Депозитов зарегистрировано мной" value={stats?.myPurchasesCount ?? '—'} icon={ShoppingCart} />
        <StatTile label="Сумма депозитов" value={stats ? `$${stats.myPurchasesRevenue.toFixed(2)}` : '—'} icon={DollarSign} />
      </div>
    </div>
  );
}

function StatTile({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Users }) {
  return (
    <div className={`${STUDIO_CARD} p-5 flex items-start justify-between`}>
      <div>
        <div className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">{label}</div>
        <div className="text-2xl font-bold mt-1 text-[#131A24] dark:text-[#E9EDF3] font-mono tabular-nums">{value}</div>
      </div>
      <Icon className="w-5 h-5 text-[#5F6B7A] dark:text-[#92A0AF]" />
    </div>
  );
}
