'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Users, FolderOpen, Send, Bot, Plus, DollarSign, Wallet, Repeat } from 'lucide-react';
import { api } from '@/lib/api';
import { ChannelAvatar } from '@/components/channel-avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatsCard, DualStatsCard } from '@/components/shared/stats-card';
import { SubscriptionBanner } from '@/components/shared/subscription-banner';
import { PeriodSelector } from '@/components/shared/period-selector';
import { usePeriodQueryState } from '@/lib/use-period-query-state';
import { useAuthStore } from '@/store/auth.store';
import { hasAnyPermission } from '@/lib/permissions';

interface CompanyStats {
  newClients: number;
  unsubscribedClients: number;
  botActivatedClients: number;
  totalRevenue: number;
  totalFd: number;
  totalRd: number;
  fdRevenue: number;
  rdRevenue: number;
  projectCount: number;
}

interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  channel: { id: string; type: string; isActive: boolean; tgAvatarFileId: string | null } | null;
  _count: { clients: number; pushes: number };
}

interface CompanyUsage {
  plan: string;
  planExpiresAt: string | null;
  maxProjects: number;
  currentProjects: number;
}

export default function OverviewPage() {
  const user = useAuthStore((s) => s.user);
  const canViewRevenue = hasAnyPermission(user, 'STATS_VIEW_REVENUE');

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });

  const { data: usage } = useQuery({
    queryKey: ['billing', 'current'],
    queryFn: async () => (await api.get<CompanyUsage>('/billing/current')).data,
  });

  const totalClients = projects?.reduce((sum, p) => sum + p._count.clients, 0) ?? 0;
  const totalPushes = projects?.reduce((sum, p) => sum + p._count.pushes, 0) ?? 0;
  const activeBots = projects?.reduce((sum, p) => sum + (p.channel?.isActive ? 1 : 0), 0) ?? 0;

  // Персистентность периода в URL (запрос пользователя 2026-08-06, вынесено в общий хук
  // 2026-08-18 — usePeriodQueryState, см. также projects/[id]/page.tsx).
  const [periodValue, setPeriodValue] = usePeriodQueryState('today');
  const periodReady = periodValue.period !== 'custom' || (!!periodValue.from && !!periodValue.to);
  const periodParams =
    periodValue.period === 'custom' ? { period: periodValue.period, from: periodValue.from, to: periodValue.to } : { period: periodValue.period };

  // Запрос пользователя 2026-08-06: "нужно на главной странице так же показать какую-то
  // статистику... кассы, клиентов, фд/рд" — компания-wide сводка по всем доступным проектам
  // сразу (GET /projects/company-stats, впервые company-wide и period-aware на главной; см.
  // ProjectsService.getCompanyStats для деталей упрощения по часовым поясам).
  const { data: companyStats } = useQuery({
    queryKey: ['company-stats', periodParams],
    queryFn: async () => (await api.get<CompanyStats>('/projects/company-stats', { params: periodParams })).data,
    enabled: periodReady,
  });

  return (
    <div className="space-y-6">
      {usage && <SubscriptionBanner plan={usage.plan} planExpiresAt={usage.planExpiresAt} />}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Обзор</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link href="/projects/new">
                <Plus className="w-4 h-4 mr-1.5" /> Новый проект
              </Link>
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard label="Клиентов" value={totalClients} icon={Users} />
        <StatsCard label="Проектов" value={usage ? `${usage.currentProjects}/${usage.maxProjects}` : '—'} icon={FolderOpen} />
        <StatsCard label="Рассылок" value={totalPushes} icon={Send} />
        <StatsCard label="Активных ботов" value={activeBots} icon={Bot} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-lg font-semibold">Статистика по всем проектам</h2>
          <PeriodSelector value={periodValue} onChange={setPeriodValue} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            label="Новые клиенты"
            value={companyStats?.newClients ?? '—'}
            icon={Users}
            dangerHint={companyStats && companyStats.unsubscribedClients > 0 ? `−${companyStats.unsubscribedClients} отписались` : undefined}
          />
          <StatsCard label="Активировали бота" value={companyStats?.botActivatedClients ?? '—'} icon={Bot} />
          {canViewRevenue && <StatsCard label="Доход" value={companyStats ? `$${companyStats.totalRevenue.toFixed(2)}` : '—'} icon={DollarSign} />}
          <DualStatsCard
            items={[
              { label: 'ФД', value: companyStats?.totalFd ?? '—', icon: Wallet },
              { label: 'РД', value: companyStats?.totalRd ?? '—', icon: Repeat },
            ]}
          />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Последние проекты</h2>
        {projectsLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
        {!projectsLoading && projects?.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              Пока нет ни одного проекта.{' '}
              <Link href="/projects/new" className="text-blue-600 hover:underline">
                Создать первый проект
              </Link>
            </CardContent>
          </Card>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects?.slice(0, 6).map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {project.channel?.type === 'TELEGRAM' && (
                        <ChannelAvatar channelId={project.channel.id} hasAvatar={!!project.channel.tgAvatarFileId} fallbackLetter={project.name} />
                      )}
                      <span className="font-medium truncate">{project.name}</span>
                    </div>
                    <Badge variant={project.status === 'ACTIVE' ? 'default' : 'secondary'}>{project.status}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {project._count.clients} клиентов · {project._count.pushes} рассылок
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
