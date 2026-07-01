'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Users, FolderOpen, Send, Bot, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatsCard } from '@/components/shared/stats-card';
import { SubscriptionBanner } from '@/components/shared/subscription-banner';

interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  channels: { id: string; type: string; isActive: boolean }[];
  _count: { clients: number; pushes: number };
}

interface CompanyUsage {
  plan: string;
  planExpiresAt: string | null;
  maxProjects: number;
  currentProjects: number;
}

export default function OverviewPage() {
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
  const activeBots = projects?.reduce((sum, p) => sum + p.channels.filter((c) => c.isActive).length, 0) ?? 0;

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

      <div>
        <h2 className="text-lg font-semibold mb-3">Последние проекты</h2>
        {projectsLoading && <p className="text-sm text-gray-500">Загрузка...</p>}
        {!projectsLoading && projects?.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">
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
                    <span className="font-medium">{project.name}</span>
                    <Badge variant={project.status === 'ACTIVE' ? 'default' : 'secondary'}>{project.status}</Badge>
                  </div>
                  <div className="text-sm text-gray-500">
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
