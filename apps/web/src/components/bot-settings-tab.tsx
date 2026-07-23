'use client';

// Вкладка "Бот" в настройках проекта — токен бота (открыто, без скрытия) и приветственное
// сообщение, которое бот отправляет при одобрении заявки на вступление (только режим
// "Приватный канал (заявка)" — только там Telegram вообще присылает боту момент "заявка
// одобрена", на который можно повесить отправку). Запрос пользователя 2026-07-03.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Check, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { TgMode } from '@/components/channel-fields-editor';
import { MediaType, MessageButton, MessageContent, EMPTY_MESSAGE_CONTENT, ScenarioMessageEditor } from '@/components/scenario-message-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ChannelBotSettings {
  id: string;
  tgBotToken: string | null;
  tgMode: TgMode | null;
  tgWelcomeMessage: string | null;
  tgWelcomeMediaType: MediaType | null;
  tgWelcomeButtons: MessageButton[] | null;
  tgJoinDelaySeconds: number | null;
  tgManagerUsernames: string[] | null;
}

export function BotSettingsTab({ projectId, channelId, channelType }: { projectId: string; channelId: string; channelType: string }) {
  const { data: full } = useQuery({
    queryKey: ['channel', channelId, 'bot-settings'],
    queryFn: async () => (await api.get<ChannelBotSettings>(`/channels/${channelId}`)).data,
  });

  if (channelType !== 'TELEGRAM') {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-gray-500">Настройки бота доступны только для Telegram-канала.</CardContent>
      </Card>
    );
  }

  if (!full) return <p className="text-sm text-gray-500">Загрузка...</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Токен бота</CardTitle>
        </CardHeader>
        <CardContent>
          <BotTokenField token={full.tgBotToken} />
        </CardContent>
      </Card>

      {full.tgMode !== 'PRIVATE_CHANNEL_REQUEST' ? (
        <Card>
          <CardContent className="p-5 text-sm text-gray-500">
            Приветственное сообщение отправляется только в режиме «Приватный канал (заявка)» — это единственный
            режим, в котором Telegram сообщает боту момент одобрения заявки. Для личных сообщений и публичного
            канала бот не участвует в подключении пользователя, и отправить приветствие некому.
          </CardContent>
        </Card>
      ) : (
        <>
          <JoinDelayCard channelId={channelId} projectId={projectId} full={full} />
          <WelcomeMessageCard channelId={channelId} projectId={projectId} full={full} />
        </>
      )}

      {/* Личного аккаунта у PERSONAL_DM в этом смысле нет вообще (лендинг ведёт прямо на
          t.me/username, без бота) — менеджерам пересылать сообщения некуда, карточку не
          показываем. Для остальных 3 режимов бот есть всегда. */}
      {full.tgMode !== 'PERSONAL_DM' && <ManagersCard channelId={channelId} projectId={projectId} full={full} />}
    </div>
  );
}

// Менеджеры (запрос пользователя 2026-07-21) — альтернатива подключению личного аккаунта:
// команда вручную фиксирует диалоги, пересылая боту сообщение клиента, вместо того чтобы
// заводить MTProto-сессию. Менеджеры никогда не становятся Client — бот перехватывает их
// сообщения раньше обычной обработки (см. TelegramProvider), поэтому им не долетают пуши/
// воронки/сценарии этого бота.
function ManagersCard({ channelId, projectId, full }: { channelId: string; projectId: string; full: ChannelBotSettings }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState((full.tgManagerUsernames || []).join('\n'));
  const [error, setError] = useState('');

  useEffect(() => {
    setText((full.tgManagerUsernames || []).join('\n'));
  }, [full.tgManagerUsernames]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/channels/${channelId}`, {
        tgManagerUsernames: text
          .split('\n')
          .map((u) => u.trim().replace(/^@/, ''))
          .filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'bot-settings'] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить список'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Менеджеры</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-500">
          По одному Telegram-username на строку, без @. Эти люди смогут переслать боту сообщение клиента и
          подтвердить запись диалога — без подключения личного аккаунта. Сами менеджеры клиентами не считаются:
          пуши, воронки и сценарии этого бота им не приходят.
        </p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'ivan_manager\nmaria_support'}
          rows={4}
          className="font-mono text-sm"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Сохраняем...' : 'Сохранить'}
        </Button>
      </CardContent>
    </Card>
  );
}

// Задержка одобрения заявки на вступление (Channel.tgJoinDelaySeconds) — запрос
// пользователя 2026-07-03, обсуждено перед разработкой отдельно от приветственного
// сообщения: Client/Subscribe-событие и пиксели фиксируются мгновенно, в момент заявки,
// задержка касается только самого approveChatJoinRequest (и приветствия вместе с ним).
function JoinDelayCard({ channelId, projectId, full }: { channelId: string; projectId: string; full: ChannelBotSettings }) {
  const queryClient = useQueryClient();
  const [seconds, setSeconds] = useState(String(full.tgJoinDelaySeconds ?? 0));
  const [error, setError] = useState('');

  useEffect(() => {
    setSeconds(String(full.tgJoinDelaySeconds ?? 0));
  }, [full.tgJoinDelaySeconds]);

  const save = useMutation({
    mutationFn: () => api.patch(`/channels/${channelId}`, { tgJoinDelaySeconds: Number(seconds) || 0 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'bot-settings'] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить задержку'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Задержка одобрения заявки</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-500">
          Заявка одобряется не сразу, а через указанное число секунд. Подписчик и событие для рекламных
          площадок фиксируются в момент заявки, задержку получает только сам вход в канал.
        </p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={3600}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            className="max-w-32"
          />
          <span className="text-sm text-gray-500">секунд (0 — без задержки, максимум 3600)</span>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Сохраняем...' : 'Сохранить'}
        </Button>
      </CardContent>
    </Card>
  );
}

function BotTokenField({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!token) return;
    await copyToClipboard(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex gap-1.5">
      <Input readOnly value={token || 'Токен не задан'} className="font-mono text-sm" />
      <Button type="button" size="icon" variant={copied ? 'default' : 'outline'} onClick={handleCopy} disabled={!token}>
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </Button>
    </div>
  );
}

function WelcomeMessageCard({ channelId, projectId, full }: { channelId: string; projectId: string; full: ChannelBotSettings }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'bot-settings'] });

  const [content, setContent] = useState<MessageContent>(EMPTY_MESSAGE_CONTENT);
  const [error, setError] = useState('');

  useEffect(() => {
    setContent({
      text: full.tgWelcomeMessage || '',
      buttons: full.tgWelcomeButtons || [],
      mediaType: full.tgWelcomeMediaType || 'NONE',
    });
  }, [full]);

  const saveText = useMutation({
    mutationFn: () =>
      api.patch(`/channels/${channelId}`, {
        tgWelcomeMessage: content.text || '',
        tgWelcomeButtons: content.buttons.filter((b) => b.text && b.url),
      }),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить сообщение'),
  });

  const uploadMedia = useMutation({
    mutationFn: async ({ file, mediaType }: { file: File; mediaType: MediaType }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mediaType', mediaType);
      await api.post(`/channels/${channelId}/welcome-media`, formData);
    },
    onSuccess: () => {
      invalidate();
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить файл'),
  });

  const removeMedia = useMutation({
    mutationFn: () => api.delete(`/channels/${channelId}/welcome-media`),
    onSuccess: () => {
      invalidate();
      setContent((c) => ({ ...c, mediaType: 'NONE' }));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Приветственное сообщение</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScenarioMessageEditor
          idPrefix="welcome"
          content={content}
          onChange={(patch) => setContent((c) => ({ ...c, ...patch }))}
          existingMediaType={full.tgWelcomeMediaType}
          onUploadMedia={(file, mediaType) => uploadMedia.mutate({ file, mediaType })}
          onRemoveMedia={() => removeMedia.mutate()}
          uploadPending={uploadMedia.isPending}
          removePending={removeMedia.isPending}
        />

        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button onClick={() => saveText.mutate()} disabled={saveText.isPending}>
          {saveText.isPending ? 'Сохраняем...' : 'Сохранить'}
        </Button>
      </CardContent>
    </Card>
  );
}
