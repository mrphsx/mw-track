'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { api } from '@/lib/api';
import { ChannelFieldsEditor, ChannelFormState, EMPTY_CHANNEL_FORM, channelFormCanSubmit, channelFormToPayload } from '@/components/channel-fields-editor';
import { TimezoneInput } from '@/components/timezone-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { STUDIO_CARD, StudioLinkButton } from '../../ui';

// Studio-версия создания проекта (запрос пользователя 2026-07-30: "реализовать всё что есть в
// проекте... добей остальные оставшиеся страницы") — логика 1:1 с классической
// (apps/web/.../(dashboard)/projects/new/page.tsx). После создания ведёт сразу на Studio-версию
// страницы проекта, а не на классическую.
export default function StudioNewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [channelForm, setChannelForm] = useState<ChannelFormState>(EMPTY_CHANNEL_FORM);
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
    onSuccess: (project) => router.push(`/dashboard/studio/projects/${project.id}`),
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать проект'),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Новый проект</h1>

      <div className={`${STUDIO_CARD} p-5 space-y-4`}>
        <h2 className="text-base font-semibold text-[#131A24] dark:text-[#E9EDF3]">Основное</h2>
        <div className="space-y-1.5">
          <Label htmlFor="name">Название</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
            Рабочее название — если подключишь Telegram-канал/бота, после успешного подключения
            подставим его настоящее имя и фото автоматически.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">Описание</Label>
          <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <TimezoneInput value={timezone} onChange={setTimezone} />
      </div>

      <div className={`${STUDIO_CARD} p-5 space-y-4`}>
        <h2 className="text-base font-semibold text-[#131A24] dark:text-[#E9EDF3]">Канал</h2>
        <ChannelFieldsEditor value={channelForm} onChange={setChannelForm} />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <StudioLinkButton
        variant="primary"
        disabled={!name || !channelFormCanSubmit(channelForm) || createProject.isPending}
        onClick={() => createProject.mutate()}
      >
        {createProject.isPending ? 'Создаём...' : 'Создать проект'}
      </StudioLinkButton>
    </div>
  );
}
