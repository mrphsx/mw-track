'use client';

// Модуль "Истории" (запрос пользователя 2026-07-21) — публикация Telegram Stories прямо из
// CRM в уже подключённый личный аккаунт, без открытия самого Telegram. Доступен только для
// проектов с Telegram-каналом (любой режим) и подключённым личным MTProto-аккаунтом.
//
// Список историй вынесен на отдельную страницу /stories/history (запрос пользователя
// 2026-07-21: "список историй нужно отдельно показывать на другой странице с пагинацией
// нормальной") — здесь только форма загрузки новой истории.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Camera, History, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AccountPicker, useStoriesOverview } from '@/components/stories/account-picker';

export default function StoriesPage() {
  const { data: overview, isLoading } = useStoriesOverview();

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  useEffect(() => {
    if (!selectedProjectId && overview?.connectedProjects.length) {
      setSelectedProjectId(overview.connectedProjects[0].id);
    }
  }, [overview, selectedProjectId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Camera className="w-6 h-6" /> Истории
        </h1>
        {overview && overview.connectedProjects.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link href="/stories/history">
                <History className="w-4 h-4 mr-1.5" /> История публикаций
              </Link>
            }
          />
        )}
      </div>

      <AboutCard />

      {isLoading && <p className="text-sm text-gray-500">Загрузка...</p>}

      {!isLoading && overview && overview.connectedProjects.length > 0 && (
        <>
          <AccountPicker
            projects={overview.connectedProjects}
            value={selectedProjectId}
            onChange={setSelectedProjectId}
          />
          {selectedProjectId && <UploadForm key={selectedProjectId} projectId={selectedProjectId} />}
        </>
      )}

      {!isLoading && overview && overview.connectedProjects.length === 0 && overview.eligibleUnconnectedProjects.length > 0 && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <p className="text-sm">
              Ни к одному проекту пока не подключён личный Telegram-аккаунт — без него публиковать
              истории некуда. Подключите его в настройках одного из проектов:
            </p>
            <div className="flex flex-wrap gap-2">
              {overview.eligibleUnconnectedProjects.map((p) => (
                <Button
                  key={p.id}
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={`/projects/${p.id}/settings`}>Подключить: {p.name}</Link>}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && overview && !overview.hasAnyTelegramProject && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <p className="text-sm">
              Чтобы использовать эту возможность, создайте проект с Telegram-каналом (подходит любой
              режим — прямой бот, приватный канал с заявкой, публичный канал или личные сообщения) и
              подключите к нему личный Telegram-аккаунт в настройках проекта.
            </p>
            <Button size="sm" nativeButton={false} render={<Link href="/projects/new">Создать проект</Link>} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AboutCard() {
  return (
    <Card>
      <CardContent className="p-5 space-y-2 text-sm text-gray-600">
        <p className="font-medium text-gray-900">Что умеет этот модуль</p>
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
        <p className="text-xs text-gray-400">
          Доступно только для проектов с Telegram-каналом (любой режим) и подключённым личным
          аккаунтом — см. вкладку «Личный аккаунт» в настройках проекта.
        </p>
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Новая история</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="story-file">Медиа (фото или видео)</Label>
          <Input
            id="story-file"
            type="file"
            accept="image/*,video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="story-caption">Подпись</Label>
          <Textarea id="story-caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={2} />
        </div>
        <div className="space-y-1.5 max-w-xs">
          <Label htmlFor="story-schedule">Опубликовать</Label>
          <Input
            id="story-schedule"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
          <p className="text-xs text-gray-400">Пусто — как можно скорее (в течение минуты).</p>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {done && <p className="text-sm text-green-600">Загружено — см. «История публикаций».</p>}
        <Button onClick={() => upload.mutate()} disabled={upload.isPending || !file}>
          <Upload className="w-4 h-4 mr-1.5" />
          {upload.isPending ? 'Загружаем...' : 'Загрузить'}
        </Button>
      </CardContent>
    </Card>
  );
}
