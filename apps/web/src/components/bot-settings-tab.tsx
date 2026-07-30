'use client';

// Вкладка "Бот" в настройках проекта — токен бота (открыто, без скрытия) и задержка одобрения
// заявки (только режим "Приватный канал (заявка)" — только там Telegram вообще присылает боту
// момент "заявка одобрена"). Приветственное сообщение само по себе с 2026-07-25 настраивается
// в сценариях (триггер "Подписка"), не здесь — см. SubscribeScenarioCard ниже, запрос
// пользователя: "убери с настроек бота приветственное сообщение при подписке и добавь его в
// сценарии". Запрос пользователя 2026-07-03 (исходная фича).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Check, CheckCircle2, Copy, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { TgMode } from '@/components/channel-fields-editor';
import { BotScenarioListItem } from '@/lib/scenarios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ChannelBotSettings {
  id: string;
  tgBotToken: string | null;
  tgMode: TgMode | null;
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
        <CardContent className="p-5 text-sm text-muted-foreground">Настройки бота доступны только для Telegram-канала.</CardContent>
      </Card>
    );
  }

  if (!full) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

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
          <CardContent className="p-5 text-sm text-muted-foreground">
            Приветственное сообщение отправляется только в режиме «Приватный канал (заявка)» — это единственный
            режим, в котором Telegram сообщает боту момент одобрения заявки. Для личных сообщений и публичного
            канала бот не участвует в подключении пользователя, и отправить приветствие некому.
          </CardContent>
        </Card>
      ) : (
        <>
          <JoinDelayCard channelId={channelId} projectId={projectId} full={full} />
          <SubscribeScenarioCard channelId={channelId} projectId={projectId} />
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
        <p className="text-sm text-muted-foreground">
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
        <p className="text-sm text-muted-foreground">
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
          <span className="text-sm text-muted-foreground">секунд (0 — без задержки, максимум 3600)</span>
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

// Индикатор + переход в сценарии (запрос пользователя 2026-07-25) — само приветственное
// сообщение теперь настраивается как обычный сценарий с триггером "Подписка" (BotScenarioTrigger.
// SUBSCRIBE), эта карточка лишь показывает, настроено ли оно, и ведёт на страницу сценариев.
// "Настроено" — есть активный SUBSCRIBE-сценарий хотя бы с одним шагом (пустой, только что
// созданный сценарий без шагов ничего не отправит, так же как выключенный).
function SubscribeScenarioCard({ channelId, projectId }: { channelId: string; projectId: string }) {
  const { data: scenarios } = useQuery({
    queryKey: ['channel', channelId, 'scenarios'],
    queryFn: async () => (await api.get<BotScenarioListItem[]>(`/channels/${channelId}/scenarios`)).data,
  });

  const subscribeScenario = scenarios?.find((s) => s.triggerType === 'SUBSCRIBE');
  const configured = !!subscribeScenario && subscribeScenario.isActive && subscribeScenario.stepCount > 0;
  const href = subscribeScenario
    ? `/projects/${projectId}/scenarios/${subscribeScenario.id}`
    : `/projects/${projectId}/scenarios`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Приветственное сообщение</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          {configured ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
              <span>Настроено — отправится при одобрении заявки на вступление</span>
            </>
          ) : (
            <>
              <XCircle className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Не настроено — новые подписчики ничего не получат</span>
            </>
          )}
        </div>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href={href}>Настроить в сценариях</Link>} />
      </CardContent>
    </Card>
  );
}
