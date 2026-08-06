'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, History, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { accountLabel, useStoriesOverview } from '@/components/stories/account-picker';
import { StoryMediaThumb } from '@/components/stories/story-media-thumb';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../../ui';

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

const STATUS_HUE: Record<string, 'amber' | 'sage' | 'slate' | 'plum' | 'teal'> = {
  PENDING: 'teal',
  PUBLISHING: 'amber',
  PUBLISHED: 'sage',
  FAILED: 'plum',
};

// Studio-версия истории публикаций историй (запрос пользователя 2026-07-30: "добей остальные
// оставшиеся страницы") — логика 1:1 с классической. StoryMediaThumb переиспользован без
// изменений. Выбор аккаунта/проекта — СВОЙ, не общий AccountPicker (запрос пользователя
// 2026-07-31: "дропдаун проектов не под общий дизайн сделан") — AccountPicker намеренно
// нейтрально стилизован (общий и для classic, и для Studio), здесь используется напрямую
// <Select> с цветами палитры Cobalt Field, как и везде в Studio.
export default function StudioStoriesHistoryPage() {
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
        <Link
          href="/stories"
          className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Истории
        </Link>
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight flex items-center gap-2">
          <History className="w-6 h-6" /> История публикаций
        </h1>
      </div>

      {overviewLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {!overviewLoading && overview && overview.connectedProjects.length > 0 && (
        <>
          <div className="max-w-sm space-y-1.5">
            <Label className="text-[#131A24] dark:text-[#E9EDF3]">Аккаунт</Label>
            <Select value={selectedProjectId} onValueChange={(v) => v && setSelectedProjectId(v)}>
              <SelectTrigger className="w-full rounded-lg border-[#DCE1E8] dark:border-white/10 bg-white dark:bg-[#171F2B] text-[#131A24] dark:text-[#E9EDF3]">
                <SelectValue>
                  {(v: string) => {
                    const p = overview.connectedProjects.find((pr) => pr.id === v);
                    return p ? accountLabel(p) : '';
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {overview.connectedProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {accountLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedProjectId && <StoriesList key={selectedProjectId} projectId={selectedProjectId} />}
        </>
      )}

      {!overviewLoading && overview && overview.connectedProjects.length === 0 && (
        <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>Нет подключённых личных аккаунтов — публиковать пока некуда.</div>
      )}
    </div>
  );
}

function StoriesList({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data } = useQuery({
    queryKey: ['stories', projectId, page],
    queryFn: async () => (await api.get<StoriesResponse>(`/projects/${projectId}/stories`, { params: { page, limit: 20 } })).data,
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
    <div className={`${STUDIO_CARD} p-5 space-y-2`}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[#131A24] dark:text-[#E9EDF3]">Публикации</h2>
        {data && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Всего: {data.total}</p>}
      </div>
      {data?.items.length === 0 && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Пока нет ни одной истории.</p>}
      {data?.items.map((story) => (
        <div key={story.id} className="flex items-center gap-3 p-2 border border-[#DCE1E8] dark:border-white/10 rounded-lg">
          <StoryMediaThumb projectId={projectId} storyId={story.id} isVideo={story.mediaType === 'VIDEO'} />
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate text-[#131A24] dark:text-[#E9EDF3]">{story.caption || <span className="text-[#5F6B7A] dark:text-[#92A0AF]">Без подписи</span>}</p>
            <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
              {story.publishedAt
                ? `Опубликовано ${format(new Date(story.publishedAt), 'd MMM yyyy, HH:mm')}`
                : story.scheduledAt
                  ? `Запланировано на ${format(new Date(story.scheduledAt), 'd MMM yyyy, HH:mm')}`
                  : 'Как можно скорее'}
            </p>
            {story.status === 'FAILED' && story.error && (
              <p className="text-xs text-red-600 dark:text-red-400 truncate" title={story.error}>
                {story.error}
              </p>
            )}
          </div>
          <StudioPill hue={STATUS_HUE[story.status]}>{STATUS_LABEL[story.status] ?? story.status}</StudioPill>
          {story.status === 'FAILED' && (
            <StudioLinkButton size="sm" icon={RotateCcw} onClick={() => retry.mutate(story.id)} disabled={retry.isPending}>
              Повторить
            </StudioLinkButton>
          )}
          {story.status === 'PENDING' && (
            <button type="button" onClick={() => remove.mutate(story.id)} disabled={remove.isPending} className="text-[#5F6B7A] dark:text-[#92A0AF] hover:text-red-600 dark:hover:text-red-400">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <StudioLinkButton size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Назад
          </StudioLinkButton>
          <span className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
            {page} / {data.totalPages}
          </span>
          <StudioLinkButton size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Далее
          </StudioLinkButton>
        </div>
      )}
    </div>
  );
}
