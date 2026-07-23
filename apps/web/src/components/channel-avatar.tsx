'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// Аватар канала/бота — подтягивается отдельным авторизованным запросом (не голым <img src>,
// у API нет cookie-сессии, только Bearer-токен в заголовке) и кэшируется как blob/object URL.
// Общий компонент — используется и в настройках проекта (список каналов), и в карточках
// лендингов (канал, на который лендинг ведёт).
export function ChannelAvatar({
  channelId,
  hasAvatar,
  fallbackLetter,
}: {
  channelId: string;
  hasAvatar: boolean;
  fallbackLetter: string;
}) {
  const { data: url } = useQuery({
    queryKey: ['channel-avatar', channelId],
    queryFn: async () => URL.createObjectURL((await api.get(`/channels/${channelId}/avatar`, { responseType: 'blob' })).data as Blob),
    enabled: hasAvatar,
    staleTime: Infinity,
    retry: false,
  });

  if (url) return <img src={url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0 border" />;
  return (
    <div className="w-10 h-10 rounded-full bg-muted border flex items-center justify-center text-sm font-medium text-muted-foreground shrink-0">
      {fallbackLetter.charAt(0).toUpperCase() || '?'}
    </div>
  );
}
