'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus, Send, Users, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { ChannelAvatar } from '@/components/channel-avatar';
import { CityTime } from '@/components/city-time';
import { CHANNEL_TYPE_LABEL, TG_MODE_LABEL, ChannelType, TgMode } from '@/components/channel-fields-editor';
import { PersonalAccountIndicator } from '@/components/personal-account-indicator';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../ui';

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
    tgPersonalConnected?: boolean;
    webhookStale?: boolean;
  } | null;
  _count: { clients: number; pushes: number };
  activeClientsCount: number;
  unsubscribedClientsCount: number;
}

const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Активен', PAUSED: 'На паузе', ARCHIVED: 'Архив' };

// Studio-версия компанейского списка проектов (запрос пользователя 2026-07-30: "сделай под
// новый дизайн ... страницу проектов") — раньше отдельной Studio-версии не было, "Обзор"
// (dashboard/studio/page.tsx) считался достаточным заменителем, но это упрощённый агрегатный
// вид (только имя/статус/2 счётчика), без CityTime/PersonalAccountIndicator/типа и режима
// канала/отписок — эта страница 1:1 повторяет содержимое классической (ChannelAvatar/CityTime/
// PersonalAccountIndicator переиспользованы без изменений, как и везде в Studio).
export default function StudioProjectsPage() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Проекты</h1>
        <StudioLinkButton variant="primary" icon={Plus} href="/projects/new">
          Новый проект
        </StudioLinkButton>
      </div>

      {isLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {!isLoading && projects?.length === 0 && (
        <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>Пока нет ни одного проекта.</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects?.map((project) => (
          <Link key={project.id} href={`/projects/${project.id}`}>
            <div className={`${STUDIO_CARD} hover:shadow-md transition-shadow h-full p-5 space-y-3`}>
              <CityTime timezone={project.timezone} className="shrink-0" />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {project.channel?.type === 'TELEGRAM' && (
                    <ChannelAvatar channelId={project.channel.id} hasAvatar={!!project.channel.tgAvatarFileId} fallbackLetter={project.name} />
                  )}
                  <span className="font-medium truncate text-[#131A24] dark:text-[#E9EDF3]">{project.name}</span>
                  {project.channel?.type === 'TELEGRAM' && (
                    <PersonalAccountIndicator projectId={project.id} connected={!!project.channel.tgPersonalConnected} />
                  )}
                </div>
                <StudioPill hue={project.status === 'ACTIVE' ? 'sage' : 'slate'}>{STATUS_LABELS[project.status] || project.status}</StudioPill>
              </div>
              <div className="flex gap-3 text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
                <span className="flex items-center gap-1" title="Клиентов / из них активных (бот не заблокирован)">
                  <Users className="w-3.5 h-3.5" /> {project._count.clients}
                  <span>/ {project.activeClientsCount}</span>
                </span>
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
                  <StudioPill hue={project.channel.isActive ? 'slate' : undefined} danger={!project.channel.isActive}>
                    {CHANNEL_TYPE_LABEL[project.channel.type as ChannelType] || project.channel.type}
                  </StudioPill>
                  {project.channel.type === 'TELEGRAM' && project.channel.tgMode && (
                    <StudioPill hue="slate">{TG_MODE_LABEL[project.channel.tgMode]}</StudioPill>
                  )}
                  {/* "Молчащий" вебхук (запрос пользователя 2026-08-05) — см. классическую
                      версию для полного комментария. */}
                  {project.channel.webhookStale && (
                    <span title="Telegram давно не присылал вебхуки этому боту — возможно, трафик не регистрируется">
                      <StudioPill danger>Нет вебхуков</StudioPill>
                    </span>
                  )}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
