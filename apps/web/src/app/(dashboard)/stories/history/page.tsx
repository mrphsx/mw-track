'use client';

// История публикаций (запрос пользователя 2026-07-21: "список историй нужно отдельно
// показывать на другой странице с пагинацией нормальной") — вынесена из /stories, тот же
// паттерн пагинации (page/limit/totalPages, кнопки Назад/Далее), что уже использует список
// клиентов (/projects/[id]/clients).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, History, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AccountPicker, useStoriesOverview } from '@/components/stories/account-picker';
import { StoryMediaThumb } from '@/components/stories/story-media-thumb';

interface StoryPostRow {
  id: string;
  mediaType: 'PHOTO' | 'VIDEO';
  caption: string | null;
  scheduledAt: string | null;
  status: 'PENDING' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED';
  publishedAt: string | null;
  error: string | null;
  createdAt: string;
}

interface StoriesResponse {
  items: StoryPostRow[];
  total: number;
  page: number;
  totalPages: number;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Ожидает',
  PUBLISHING: 'Публикуется',
  PUBLISHED: 'Опубликовано',
  FAILED: 'Ошибка',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'outline',
  PUBLISHING: 'secondary',
  PUBLISHED: 'default',
  FAILED: 'destructive',
};

export default function StoriesHistoryPage() {
  const { data: overview, isLoading: overviewLoading } = useStoriesOverview();

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  useEffect(() => {
    if (!selectedProjectId && overview?.connectedProjects.length) {
      setSelectedProjectId(overview.connectedProjects[0].id);
    }
  }, [overview, selectedProjectId]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/stories" className="text-sm text-gray-500 hover:underline inline-flex items-center gap-1 mb-2">
          <ArrowLeft className="w-3.5 h-3.5" /> Истории
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <History className="w-6 h-6" /> История публикаций
        </h1>
      </div>

      {overviewLoading && <p className="text-sm text-gray-500">Загрузка...</p>}

      {!overviewLoading && overview && overview.connectedProjects.length > 0 && (
        <>
          <AccountPicker
            projects={overview.connectedProjects}
            value={selectedProjectId}
            onChange={setSelectedProjectId}
          />
          {selectedProjectId && <StoriesList key={selectedProjectId} projectId={selectedProjectId} />}
        </>
      )}

      {!overviewLoading && overview && overview.connectedProjects.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">
            Нет подключённых личных аккаунтов — публиковать пока некуда.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StoriesList({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data } = useQuery({
    queryKey: ['stories', projectId, page],
    queryFn: async () =>
      (await api.get<StoriesResponse>(`/projects/${projectId}/stories`, { params: { page, limit: 20 } })).data,
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['stories', projectId] });

  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/projects/${projectId}/stories/${id}/retry`),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${projectId}/stories/${id}`),
    onSuccess: invalidate,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Публикации</CardTitle>
        {data && <p className="text-sm text-gray-500">Всего: {data.total}</p>}
      </CardHeader>
      <CardContent className="space-y-2">
        {data?.items.length === 0 && <p className="text-sm text-gray-500">Пока нет ни одной истории.</p>}
        {data?.items.map((story) => (
          <div key={story.id} className="flex items-center gap-3 p-2 border rounded-lg">
            <StoryMediaThumb projectId={projectId} storyId={story.id} isVideo={story.mediaType === 'VIDEO'} />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{story.caption || <span className="text-gray-400">Без подписи</span>}</p>
              <p className="text-xs text-gray-500">
                {story.publishedAt
                  ? `Опубликовано ${format(new Date(story.publishedAt), 'd MMM yyyy, HH:mm')}`
                  : story.scheduledAt
                    ? `Запланировано на ${format(new Date(story.scheduledAt), 'd MMM yyyy, HH:mm')}`
                    : 'Как можно скорее'}
              </p>
              {story.status === 'FAILED' && story.error && (
                <p className="text-xs text-red-500 truncate" title={story.error}>{story.error}</p>
              )}
            </div>
            <Badge variant={STATUS_VARIANT[story.status]}>{STATUS_LABEL[story.status] ?? story.status}</Badge>
            {story.status === 'FAILED' && (
              <Button size="sm" variant="ghost" onClick={() => retry.mutate(story.id)} disabled={retry.isPending}>
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Повторить
              </Button>
            )}
            {story.status === 'PENDING' && (
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(story.id)} disabled={remove.isPending}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        ))}

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Назад
            </Button>
            <span className="text-sm text-gray-500">
              {page} / {data.totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Далее
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
