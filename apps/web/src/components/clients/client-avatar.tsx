'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// Аватар клиента — тот же blob-фетч-паттерн, что и ChannelAvatar (@/components/channel-avatar),
// просто на /projects/:projectId/clients/:clientId/avatar (авторизованный, не публичный —
// фото самого клиента чувствительнее аватара канала/лендинга).
export function ClientAvatar({
  projectId,
  clientId,
  hasAvatar,
  fallbackLetter,
}: {
  projectId: string;
  clientId: string;
  hasAvatar: boolean;
  fallbackLetter: string;
}) {
  const { data: url } = useQuery({
    queryKey: ['client-avatar', clientId],
    queryFn: async () =>
      URL.createObjectURL((await api.get(`/projects/${projectId}/clients/${clientId}/avatar`, { responseType: 'blob' })).data as Blob),
    enabled: hasAvatar,
    staleTime: Infinity,
    retry: false,
  });

  if (url) return <img src={url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border" />;
  return (
    <div className="w-8 h-8 rounded-full bg-muted border flex items-center justify-center text-xs font-medium text-muted-foreground shrink-0">
      {fallbackLetter.charAt(0).toUpperCase() || '?'}
    </div>
  );
}
