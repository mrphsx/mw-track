'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus, Send, Users, UserCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { ChannelAvatar } from '@/components/channel-avatar';
import { CityTime } from '@/components/city-time';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  timezone: string;
  channel: {
    id: string;
    type: string;
    isActive: boolean;
    tgAvatarFileId: string | null;
    // Есть только у Telegram-канала — MTProto-подключение личного аккаунта, отдельное от
    // самого бота (запрос пользователя 2026-07-21: "значок если добавлен личный аккаунт").
    tgPersonalConnected?: boolean;
  } | null;
  _count: { clients: number; pushes: number };
  activeClientsCount: number;
}

const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Активен', PAUSED: 'На паузе', ARCHIVED: 'Архив' };

export default function ProjectsPage() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Проекты</h1>
        <Button
          nativeButton={false}
          render={
            <Link href="/projects/new">
              <Plus className="w-4 h-4 mr-1.5" /> Новый проект
            </Link>
          }
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}

      {!isLoading && projects?.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">Пока нет ни одного проекта.</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects?.map((project) => (
          <Link key={project.id} href={`/projects/${project.id}`}>
            <Card className="hover:shadow-md transition-shadow h-full">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    {project.channel?.type === 'TELEGRAM' && (
                      <ChannelAvatar channelId={project.channel.id} hasAvatar={!!project.channel.tgAvatarFileId} fallbackLetter={project.name} />
                    )}
                    <span className="font-medium truncate">{project.name}</span>
                    {project.channel?.tgPersonalConnected && (
                      <span title="Личный аккаунт Telegram подключён">
                        <UserCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                      </span>
                    )}
                  </div>
                  <Badge variant={project.status === 'ACTIVE' ? 'default' : 'secondary'}>
                    {STATUS_LABELS[project.status] || project.status}
                  </Badge>
                </div>
                <div className="flex gap-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1" title="Клиентов / из них активных (бот не заблокирован)">
                    <Users className="w-3.5 h-3.5" /> {project._count.clients}
                    <span className="text-muted-foreground">/ {project.activeClientsCount}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Send className="w-3.5 h-3.5" /> {project._count.pushes}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  {project.channel && (
                    <div className="flex gap-1.5">
                      <Badge variant={project.channel.isActive ? 'outline' : 'destructive'} className="text-xs">
                        {project.channel.type}
                      </Badge>
                    </div>
                  )}
                  <CityTime timezone={project.timezone} />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
