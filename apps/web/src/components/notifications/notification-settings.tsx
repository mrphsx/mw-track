'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Bell, Send, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

// Настройки Telegram-бота служебных оповещений компании (запрос пользователя 2026-09-16).
// Один компонент для обоих интерфейсов: shadcn-примитивы корректно красятся в тёмной теме Studio
// через .studio.dark (см. globals.css), а подложку карточек Studio передаёт через containerClassName.

interface NotificationTypeInfo {
  id: string;
  label: string;
  description: string;
}

interface Recipient {
  id: string;
  // null — человек убрал юзернейм в Telegram; опознаём его по tgUserId.
  username: string | null;
  tgUserId: string | null;
  tgFirstName: string | null;
  linked: boolean;
  linkedAt: string | null;
  enabledTypes: string[];
  lastError: string | null;
}

interface NotificationSettingsData {
  bot: { id: string; tgBotUsername: string; isActive: boolean; lastError: string | null; createdAt: string } | null;
  recipients: Recipient[];
  types: NotificationTypeInfo[];
}

// Короткие подписи для заголовков колонок — полные названия и описания стоят в легенде под таблицей.
const SHORT_LABEL: Record<string, string> = {
  LOW_BALANCE: 'Баланс',
  TRIAL_EXPIRING: 'Конец триала',
  PLAN_DOWNGRADED: 'Тариф понижен',
  CHANNEL_DISCONNECTED: 'Канал отключён',
  WEBHOOK_STALE: 'Нет обновлений',
  PERSONAL_ACCOUNT_DISCONNECTED: 'Личный аккаунт',
  PIXEL_DELIVERY_FAILING: 'Пиксели',
};

const QUERY_KEY = ['notifications', 'settings'];

function recipientLabel(r: Recipient): string {
  if (r.username) return `@${r.username}`;
  return r.tgFirstName || `ID ${r.tgUserId}`;
}

function errorText(err: unknown, fallback: string): string {
  return (isAxiosError(err) && err.response?.data?.error?.message) || fallback;
}

export function NotificationSettings({ containerClassName }: { containerClassName?: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await api.get<NotificationSettingsData>('/notifications/settings')).data,
  });
  const setData = (next: NotificationSettingsData) => queryClient.setQueryData(QUERY_KEY, next);

  if (isLoading || !data) {
    return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  }

  return (
    <div className="space-y-6">
      <BotCard data={data} onChange={setData} containerClassName={containerClassName} />
      {data.bot && <RecipientsCard data={data} onChange={setData} containerClassName={containerClassName} />}
    </div>
  );
}

function BotCard({
  data,
  onChange,
  containerClassName,
}: {
  data: NotificationSettingsData;
  onChange: (d: NotificationSettingsData) => void;
  containerClassName?: string;
}) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const connect = useMutation({
    mutationFn: async () => (await api.post<NotificationSettingsData>('/notifications/bot', { token })).data,
    onSuccess: (next) => {
      setToken('');
      setError(null);
      onChange(next);
    },
    onError: (err) => setError(errorText(err, 'Не удалось подключить бота')),
  });

  const disconnect = useMutation({
    mutationFn: async () => (await api.delete<NotificationSettingsData>('/notifications/bot')).data,
    onSuccess: onChange,
    onError: (err) => setError(errorText(err, 'Не удалось отключить бота')),
  });

  const bot = data.bot;

  return (
    <Card className={containerClassName}>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="w-4 h-4" /> Бот оповещений
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!bot && (
          <>
            <p className="text-sm text-muted-foreground">
              Бот пишет в Telegram, когда в компании что-то сломалось: заканчиваются деньги на продление, отключился бот
              проекта, отозвана сессия личного аккаунта. Используйте отдельного бота — не того, что подключён к каналу проекта.
            </p>
            <ol className="text-sm space-y-1 list-decimal pl-5">
              <li>
                Откройте{' '}
                <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="underline">
                  @BotFather
                </a>
                , отправьте <code>/newbot</code> и придумайте имя.
              </li>
              <li>Скопируйте токен, который пришлёт BotFather.</li>
              <li>Вставьте его ниже — подключение сразу проверится.</li>
            </ol>
            <form
              className="flex flex-col sm:flex-row gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (token.trim()) connect.mutate();
              }}
            >
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456789:AAF..."
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
              <Button type="submit" disabled={!token.trim() || connect.isPending}>
                {connect.isPending ? 'Проверяем…' : 'Подключить'}
              </Button>
            </form>
          </>
        )}

        {bot && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <a
                  href={`https://t.me/${bot.tgBotUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline-offset-2 hover:underline"
                >
                  @{bot.tgBotUsername}
                </a>
                <StatusPill tone={bot.isActive ? 'good' : 'bad'}>{bot.isActive ? 'Работает' : 'Не работает'}</StatusPill>
              </div>
              {bot.lastError && <p className="text-xs text-destructive">{bot.lastError}</p>}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={disconnect.isPending}
              onClick={() => {
                if (confirm('Отключить бота оповещений? Список получателей будет удалён.')) disconnect.mutate();
              }}
            >
              Отключить
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function RecipientsCard({
  data,
  onChange,
  containerClassName,
}: {
  data: NotificationSettingsData;
  onChange: (d: NotificationSettingsData) => void;
  containerClassName?: string;
}) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Итог "Тест" по каждой строке: пусто — не нажимали, иначе текст результата.
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; text: string }>>({});
  const botUsername = data.bot?.tgBotUsername ?? '';

  const add = useMutation({
    mutationFn: async () =>
      (await api.post<NotificationSettingsData>('/notifications/recipients', { username })).data,
    onSuccess: (next) => {
      setUsername('');
      setError(null);
      onChange(next);
    },
    onError: (err) => setError(errorText(err, 'Не удалось добавить получателя')),
  });

  const update = useMutation({
    mutationFn: async ({ id, enabledTypes }: { id: string; enabledTypes: string[] }) =>
      (await api.patch<NotificationSettingsData>(`/notifications/recipients/${id}`, { enabledTypes })).data,
    onSuccess: onChange,
    onError: (err) => setError(errorText(err, 'Не удалось сохранить')),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete<NotificationSettingsData>(`/notifications/recipients/${id}`)).data,
    onSuccess: onChange,
    onError: (err) => setError(errorText(err, 'Не удалось удалить')),
  });

  const test = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/notifications/recipients/${id}/test`);
      return id;
    },
    onSuccess: (id) => setTestResult((r) => ({ ...r, [id]: { ok: true, text: 'Отправлено' } })),
    onError: (err, id) => setTestResult((r) => ({ ...r, [id]: { ok: false, text: errorText(err, 'Не доставлено') } })),
  });

  const toggle = (recipient: Recipient, typeId: string, checked: boolean) => {
    const next = checked
      ? [...recipient.enabledTypes, typeId]
      : recipient.enabledTypes.filter((t) => t !== typeId);
    // Мгновенно в интерфейсе, сервер подтверждает ответом.
    onChange({
      ...data,
      recipients: data.recipients.map((r) => (r.id === recipient.id ? { ...r, enabledTypes: next } : r)),
    });
    update.mutate({ id: recipient.id, enabledTypes: next });
  };

  return (
    <Card className={containerClassName}>
      <CardHeader>
        <CardTitle className="text-base">Кто и какие оповещения получает</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-muted/60 p-3 text-sm space-y-1">
          <p>
            Telegram не даёт боту написать человеку первым. Поэтому каждый получатель после добавления должен открыть{' '}
            <a
              href={`https://t.me/${botUsername}?start=1`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
            >
              @{botUsername}
            </a>{' '}
            и нажать <b>Start</b> — бот сверит его юзернейм со списком и начнёт присылать оповещения.
          </p>
          <p className="text-muted-foreground">
            После Start получатель привязывается к своему Telegram ID: если он сменит или уберёт юзернейм, оповещения
            продолжат приходить, а имя здесь обновится само. Отписаться можно командой /stop в самом боте.
          </p>
        </div>

        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim()) add.mutate();
          }}
        >
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="@username"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" disabled={!username.trim() || add.isPending}>
            Добавить получателя
          </Button>
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {data.recipients.length === 0 ? (
          <p className="text-sm text-muted-foreground">Получателей пока нет — добавьте первый юзернейм выше.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left font-medium px-2 py-2">Получатель</th>
                  {data.types.map((t) => (
                    <th key={t.id} title={t.description} className="font-medium px-2 py-2 text-center align-bottom w-20">
                      {SHORT_LABEL[t.id] ?? t.label}
                    </th>
                  ))}
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.recipients.map((r) => (
                  <tr key={r.id} className="align-middle">
                    <td className="px-2 py-2.5 min-w-44">
                      <div className="font-medium">{recipientLabel(r)}</div>
                      {r.tgUserId && (
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {r.username && r.tgFirstName ? `${r.tgFirstName} · ` : ''}ID {r.tgUserId}
                        </div>
                      )}
                      <div className="mt-1">
                        {r.linked ? (
                          <StatusPill tone="good">Подключён</StatusPill>
                        ) : (
                          <StatusPill tone="wait">Ждём Start в боте</StatusPill>
                        )}
                      </div>
                      {r.lastError && <p className="text-xs text-destructive mt-1 max-w-56">{r.lastError}</p>}
                      {testResult[r.id] && (
                        <p className={cn('text-xs mt-1 max-w-56', testResult[r.id].ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
                          {testResult[r.id].text}
                        </p>
                      )}
                    </td>
                    {data.types.map((t) => (
                      <td key={t.id} className="px-2 py-2.5 text-center">
                        <div className="flex justify-center">
                          <Checkbox
                            checked={r.enabledTypes.includes(t.id)}
                            onCheckedChange={(checked) => toggle(r, t.id, checked === true)}
                            aria-label={`${t.label} для ${recipientLabel(r)}`}
                          />
                        </div>
                      </td>
                    ))}
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!r.linked || (test.isPending && test.variables === r.id)}
                          title={r.linked ? 'Отправить тестовое сообщение' : 'Получатель ещё не нажал Start'}
                          onClick={() => test.mutate(r.id)}
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span className="ml-1">Тест</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Удалить получателя"
                          aria-label={`Удалить ${recipientLabel(r)}`}
                          onClick={() => {
                            if (confirm(`Удалить ${recipientLabel(r)} из получателей?`)) remove.mutate(r.id);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-xs pt-2 border-t">
          {data.types.map((t) => (
            <div key={t.id}>
              <dt className="font-medium">{t.label}</dt>
              <dd className="text-muted-foreground">{t.description}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function StatusPill({ tone, children }: { tone: 'good' | 'bad' | 'wait'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        tone === 'good' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
        tone === 'bad' && 'bg-destructive/15 text-destructive',
        tone === 'wait' && 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
      )}
    >
      {children}
    </span>
  );
}
