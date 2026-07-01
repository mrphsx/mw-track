'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Users, TrendingUp, DollarSign, Percent, Settings, Send, LayoutTemplate } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatsCard } from '@/components/shared/stats-card';

interface Project {
  id: string;
  name: string;
  status: string;
  channels: { id: string; type: string; isActive: boolean }[];
}

interface ProjectStats {
  totalClients: number;
  activeClients: number;
  conversionRate: number;
  totalRevenue: number;
  dailySubscribers: { date: string; count: number }[];
}

interface FunnelStage {
  stage: string;
  count: number;
  label: string;
  rate?: number;
}

interface ClientRow {
  id: string;
  tgFirstName: string | null;
  tgUsername: string | null;
  channelType: string | null;
  country: string | null;
  createdAt: string;
}

export default function ProjectOverviewPage() {
  const { id } = useParams<{ id: string }>();

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => (await api.get<Project>(`/projects/${id}`)).data,
  });

  const { data: stats } = useQuery({
    queryKey: ['project', id, 'stats'],
    queryFn: async () => (await api.get<ProjectStats>(`/projects/${id}/clients/stats`)).data,
  });

  const { data: funnel } = useQuery({
    queryKey: ['project', id, 'funnel'],
    queryFn: async () => (await api.get<FunnelStage[]>(`/projects/${id}/clients/funnel`)).data,
  });

  const { data: recentClients } = useQuery({
    queryKey: ['project', id, 'recent-clients'],
    queryFn: async () => (await api.get<{ items: ClientRow[] }>(`/projects/${id}/clients`, { params: { limit: 5 } })).data.items,
  });

  if (!project) return <p className="text-sm text-gray-500">Загрузка...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <div className="flex gap-1.5 mt-1.5">
            {project.channels.map((c) => (
              <Badge key={c.id} variant={c.isActive ? 'outline' : 'destructive'} className="text-xs">
                {c.type}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            nativeButton={false}
            render={
              <Link href={`/projects/${id}/pushes/new`}>
                <Send className="w-4 h-4 mr-1.5" /> Рассылка
              </Link>
            }
          />
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link href={`/projects/${id}/landings`}>
                <LayoutTemplate className="w-4 h-4 mr-1.5" /> Лендинги
              </Link>
            }
          />
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link href={`/projects/${id}/settings`}>
                <Settings className="w-4 h-4 mr-1.5" /> Настройки
              </Link>
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard label="Клиентов" value={stats?.totalClients ?? '—'} icon={Users} />
        <StatsCard label="Активных" value={stats?.activeClients ?? '—'} icon={TrendingUp} />
        <StatsCard label="Доход" value={stats ? `$${stats.totalRevenue.toFixed(2)}` : '—'} icon={DollarSign} />
        <StatsCard label="Конверсия" value={stats ? `${stats.conversionRate}%` : '—'} icon={Percent} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Подписчики за 30 дней</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={stats?.dailySubscribers ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')} />
                <Line type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Воронка конверсий</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {funnel?.map((stage) => (
              <div key={stage.stage} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{stage.label}</div>
                  {stage.rate !== undefined && <div className="text-xs text-gray-400">{stage.rate}% от предыдущего</div>}
                </div>
                <div className="text-lg font-bold">{stage.count}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Последние клиенты</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentClients?.length === 0 && <p className="text-sm text-gray-500">Пока нет клиентов.</p>}
          {recentClients?.map((client) => (
            <div key={client.id} className="flex items-center justify-between py-1.5 text-sm">
              <span>{client.tgFirstName || client.tgUsername || client.id}</span>
              <span className="text-gray-400">{client.country || '—'}</span>
            </div>
          ))}
          <Link href={`/projects/${id}/clients`} className="text-sm text-blue-600 hover:underline inline-block pt-1">
            Все клиенты →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
