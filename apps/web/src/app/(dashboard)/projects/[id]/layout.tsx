'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ChannelAvatar } from '@/components/channel-avatar';
import { CityTime } from '@/components/city-time';
import { PersonalAccountIndicator } from '@/components/personal-account-indicator';

interface ProjectHeaderData {
  id: string;
  name: string;
  timezone: string;
  channel: {
    id: string;
    type: string;
    tgAvatarFileId: string | null;
    // Личный MTProto-аккаунт, отдельно от самого бота (запрос пользователя 2026-07-21:
    // "значок если добавлен личный аккаунт телеграм").
    tgPersonalConnected?: boolean;
  } | null;
}

// Общий заголовок проекта на всех /projects/[id]/* страницах (запрос пользователя 2026-07-18:
// "на всех страницах редактирования проекта нужно добавить его название и иконку сверху для
// понимания") — queryKey дословно совпадает с тем, что уже используют page.tsx и
// settings/page.tsx, React Query дедуплицирует запрос вместо повторного похода в API.
export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => (await api.get<ProjectHeaderData>(`/projects/${id}`)).data,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        {project?.channel?.type === 'TELEGRAM' ? (
          <ChannelAvatar
            channelId={project.channel.id}
            hasAvatar={!!project.channel.tgAvatarFileId}
            fallbackLetter={project.name}
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-muted border shrink-0" />
        )}
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-base font-semibold text-muted-foreground truncate">{project?.name ?? ' '}</h2>
          {project?.channel?.type === 'TELEGRAM' && id && (
            <PersonalAccountIndicator projectId={id} connected={!!project.channel.tgPersonalConnected} size="md" />
          )}
        </div>
        {project?.timezone && <CityTime timezone={project.timezone} className="shrink-0" />}
      </div>
      {children}
    </div>
  );
}
