'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Camera, History, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { AccountPicker, useStoriesOverview } from '@/components/stories/account-picker';
import { STUDIO_CARD, StudioLinkButton } from '../ui';

// Studio-версия страницы историй (запрос пользователя 2026-07-30: "готовить все остальные
// страницы") — логика 1:1 с классической (apps/web/.../(dashboard)/stories/page.tsx).
// AccountPicker переиспользован без изменений (сложный самодостаточный виджет). Страница
// истории публикаций тоже получила Studio-версию тем же днём ("добей остальные оставшиеся
// страницы") — dashboard/studio/stories/history.
export default function StudioStoriesPage() {
  const { data: overview, isLoading } = useStoriesOverview();

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  useEffect(() => {
    if (!selectedProjectId && overview?.connectedProjects.length) {
      setSelectedProjectId(overview.connectedProjects[0].id);
    }
  }, [overview, selectedProjectId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="flex items-center gap-2 text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">
          <Camera className="w-7 h-7" /> Истории
        </h1>
        {overview && overview.connectedProjects.length > 0 && (
          <StudioLinkButton icon={History} size="sm" href="/stories/history">
            История публикаций
          </StudioLinkButton>
        )}
      </div>

      <AboutCard />

      {isLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {!isLoading && overview && overview.connectedProjects.length > 0 && (
        <>
          <AccountPicker projects={overview.connectedProjects} value={selectedProjectId} onChange={setSelectedProjectId} />
          {selectedProjectId && <UploadForm key={selectedProjectId} projectId={selectedProjectId} />}
        </>
      )}

      {!isLoading && overview && overview.connectedProjects.length === 0 && overview.eligibleUnconnectedProjects.length > 0 && (
        <div className={`${STUDIO_CARD} p-6 space-y-3`}>
          <p className="text-sm text-[#131A24] dark:text-[#E9EDF3]">
            Ни к одному проекту пока не подключён личный Telegram-аккаунт — без него публиковать
            истории некуда. Подключите его в настройках одного из проектов:
          </p>
          <div className="flex flex-wrap gap-2">
            {overview.eligibleUnconnectedProjects.map((p) => (
              <StudioLinkButton key={p.id} size="sm" href={`/projects/${p.id}/settings?tab=personal`}>
                Подключить: {p.name}
              </StudioLinkButton>
            ))}
          </div>
        </div>
      )}

      {!isLoading && overview && !overview.hasAnyTelegramProject && (
        <div className={`${STUDIO_CARD} p-6 space-y-3`}>
          <p className="text-sm text-[#131A24] dark:text-[#E9EDF3]">
            Чтобы использовать эту возможность, создайте проект с Telegram-каналом (подходит любой
            режим — прямой бот, приватный канал с заявкой, публичный канал или личные сообщения) и
            подключите к нему личный Telegram-аккаунт в настройках проекта.
          </p>
          <StudioLinkButton variant="primary" size="sm" href="/projects/new">
            Создать проект
          </StudioLinkButton>
        </div>
      )}
    </div>
  );
}

function AboutCard() {
  return (
    <div className={`${STUDIO_CARD} p-5 space-y-2 text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>
      <p className="font-medium text-[#131A24] dark:text-[#E9EDF3]">Что умеет этот модуль</p>
      <p>
        Публикация Telegram Stories прямо из CRM, без необходимости открывать сам Telegram на
        телефоне — медиа, подпись и (по желанию) время публикации задаются здесь.
      </p>
      <ul className="list-disc pl-5 space-y-0.5">
        <li>Планирование публикации на конкретную дату и время — или сразу, как можно скорее.</li>
        <li>История/аудит того, что и когда было опубликовано, по каждому аккаунту.</li>
        <li>Повтор публикации одной кнопкой при ошибке.</li>
        <li>Несколько подключённых личных аккаунтов — из одного места.</li>
      </ul>
      <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
        Доступно только для проектов с Telegram-каналом (любой режим) и подключённым личным
        аккаунтом — см. вкладку «Личный аккаунт» в настройках проекта.
      </p>
    </div>
  );
}

function UploadForm({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Выберите файл');
      const formData = new FormData();
      formData.append('file', file);
      if (caption) formData.append('caption', caption);
      if (scheduledAt) formData.append('scheduledAt', new Date(scheduledAt).toISOString());
      await api.post(`/projects/${projectId}/stories`, formData);
    },
    onSuccess: () => {
      setFile(null);
      setCaption('');
      setScheduledAt('');
      setError('');
      setDone(true);
      queryClient.invalidateQueries({ queryKey: ['stories', projectId] });
      setTimeout(() => setDone(false), 3000);
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить историю'),
  });

  return (
    <div className={`${STUDIO_CARD} p-5 space-y-3`}>
      <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Новая история</h2>
      <div className="space-y-1.5">
        <Label htmlFor="story-file">Медиа (фото или видео)</Label>
        <Input id="story-file" type="file" accept="image/*,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="story-caption">Подпись</Label>
        <Textarea id="story-caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={2} />
      </div>
      <div className="space-y-1.5 max-w-xs">
        <Label htmlFor="story-schedule">Опубликовать</Label>
        <Input id="story-schedule" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Пусто — как можно скорее (в течение минуты).</p>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {done && <p className="text-sm text-[#1F7A6C] dark:text-[#6FCBBA]">Загружено — см. «История публикаций».</p>}
      <StudioLinkButton variant="primary" icon={Upload} onClick={() => upload.mutate()} disabled={upload.isPending || !file}>
        {upload.isPending ? 'Загружаем...' : 'Загрузить'}
      </StudioLinkButton>
    </div>
  );
}

