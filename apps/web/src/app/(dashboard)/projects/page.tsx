'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus, Send, Users, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { ChannelAvatar } from '@/components/channel-avatar';
import { hasChannelAvatar } from '@/lib/landings';
import { CityTime } from '@/components/city-time';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CHANNEL_TYPE_LABEL, TG_MODE_LABEL, ChannelType, TgMode } from '@/components/channel-fields-editor';
import { PersonalAccountIndicator } from '@/components/personal-account-indicator';

interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  timezone: string;
  channel: {
    id: string;
    type: string;
    isActive: boolean;
    tgMode: TgMode | null;
    tgAvatarFileId: string | null;
    websiteFaviconUrl?: string | null;
    // Есть только у Telegram-канала — MTProto-подключение личного аккаунта, отдельное от
    // самого бота (запрос пользователя 2026-07-21: "значок если добавлен личный аккаунт").
    tgPersonalConnected?: boolean;
    // Запрос пользователя 2026-08-05 (после реального ~20-часового инцидента: Telegram молча
    // перестал слать вебхуки боту, узнали постфактум) — true, если от Telegram давно не было
    // вообще никаких вебхуков для этого канала, при том что раньше они были.
    webhookStale?: boolean;
  } | null;
  _count: { clients: number; pushes: number };
  activeClientsCount: number;
  // Запрос пользователя 2026-07-28: "покажи количество отписок, за всё время как и клиентов".
  unsubscribedClientsCount: number;
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
                {/* Гео+время наверх, отдельной строкой (запрос пользователя 2026-07-28: "чтобы
                    не сжималась и не переходила с новой строки") — раньше делила нижнюю строку
                    с бейджами типа/режима канала и в узкой карточке сжималась/переносилась. */}
                <CityTime timezone={project.timezone} className="shrink-0" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    {(project.channel?.type === 'TELEGRAM' || project.channel?.type === 'WEBSITE') && (
                      <ChannelAvatar channelId={project.channel.id} hasAvatar={hasChannelAvatar(project.channel)} fallbackLetter={project.name} />
                    )}
                    <span className="font-medium truncate">{project.name}</span>
                    {project.channel?.type === 'TELEGRAM' && (
                      <PersonalAccountIndicator projectId={project.id} connected={!!project.channel.tgPersonalConnected} />
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
                  {/* Отписки за всё время (запрос пользователя 2026-07-28: "как внутри проекта,
                      только за всё время как и клиентов") — показываем только когда есть хоть
                      одна, чтобы не засорять карточки с нулём. */}
                  {project.unsubscribedClientsCount > 0 && (
                    <span className="flex items-center gap-1 text-red-500 dark:text-red-400" title="Отписались за всё время">
                      <UserX className="w-3.5 h-3.5" /> {project.unsubscribedClientsCount}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Send className="w-3.5 h-3.5" /> {project._count.pushes}
                  </span>
                </div>
                {project.channel && (
                  <div className="flex gap-1.5 flex-wrap">
                    <Badge variant={project.channel.isActive ? 'outline' : 'destructive'} className="text-xs">
                      {CHANNEL_TYPE_LABEL[project.channel.type as ChannelType] || project.channel.type}
                    </Badge>
                    {/* Режим Telegram-канала (запрос пользователя 2026-07-27: "добавь тип
                        проекта, приватный канал, публичный, личка, бот итд") — только у
                        Telegram, у WhatsApp/Instagram единственный режим и так есть в типе. */}
                    {project.channel.type === 'TELEGRAM' && project.channel.tgMode && (
                      <Badge variant="secondary" className="text-xs">
                        {TG_MODE_LABEL[project.channel.tgMode]}
                      </Badge>
                    )}
                    {/* "Молчащий" вебхук (запрос пользователя 2026-08-05) — отдельно от
                        isActive/"заблокирован": бот технически жив, просто Telegram перестал
                        присылать ему апдейты (реальный инцидент, обнаруженный только по логам
                        nginx постфактум). */}
                    {project.channel.webhookStale && (
                      <Badge variant="destructive" className="text-xs" title="Telegram давно не присылал вебхуки этому боту — возможно, трафик не регистрируется">
                        Нет вебхуков
                      </Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
