'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { api } from '@/lib/api';
import { ChannelFieldsEditor, ChannelFormState, EMPTY_CHANNEL_FORM, channelFormCanSubmit, channelFormToPayload } from '@/components/channel-fields-editor';
import { TimezoneInput } from '@/components/timezone-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Проект сам "становится" каналом (1:1 с 2026-07-02) — тип и конфигурация канала
// запрашиваются сразу тут, не добавляются отдельным шагом в настройках позже.
export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [channelForm, setChannelForm] = useState<ChannelFormState>(EMPTY_CHANNEL_FORM);
  // Часовой пояс браузера как разумное значение по умолчанию — пользователь чаще всего
  // настраивает проект под свою же аудиторию/себя, поправит вручную если нужен другой.
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [error, setError] = useState('');

  const createProject = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/projects', {
        name,
        description: description || undefined,
        timezone,
        channel: { type: channelForm.type, ...channelFormToPayload(channelForm) },
      });
      return data;
    },
    onSuccess: (project) => router.push(`/projects/${project.id}`),
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать проект'),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Новый проект</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Основное</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Название</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            <p className="text-xs text-gray-500">
              Рабочее название — если подключишь Telegram-канал/бота, после успешного подключения
              подставим его настоящее имя и фото автоматически.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Описание</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <TimezoneInput value={timezone} onChange={setTimezone} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Канал</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChannelFieldsEditor value={channelForm} onChange={setChannelForm} />
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button
        disabled={!name || !channelFormCanSubmit(channelForm) || createProject.isPending}
        onClick={() => createProject.mutate()}
      >
        {createProject.isPending ? 'Создаём...' : 'Создать проект'}
      </Button>
    </div>
  );
}
