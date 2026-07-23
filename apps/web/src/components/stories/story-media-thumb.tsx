'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// Маленькое превью медиа в списке историй — тот же blob-фетч-паттерн, что и ClientAvatar/
// ChannelAvatar (эндпоинт авторизованный, не публичный, см. StoriesController.streamMedia).
export function StoryMediaThumb({
  projectId,
  storyId,
  isVideo,
}: {
  projectId: string;
  storyId: string;
  isVideo: boolean;
}) {
  const { data: url } = useQuery({
    queryKey: ['story-media', storyId],
    queryFn: async () =>
      URL.createObjectURL(
        (await api.get(`/projects/${projectId}/stories/${storyId}/media`, { responseType: 'blob' })).data as Blob,
      ),
    staleTime: Infinity,
    retry: false,
  });

  if (!url) return <div className="w-12 h-12 rounded bg-gray-100 border shrink-0 animate-pulse" />;

  return isVideo ? (
    <video src={url} className="w-12 h-12 rounded object-cover border shrink-0" muted />
  ) : (
    <img src={url} alt="" className="w-12 h-12 rounded object-cover border shrink-0" />
  );
}
