'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ExternalLink, Send, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Вход в CRM из Telegram (2026-10-26): сотрудник привязывает к своему профилю один или несколько
// Telegram-аккаунтов (2–3 владельца на одном профиле) — по @тегу или по одноразовой ссылке на бот.
// После этого CRM открывается кнопкой «Открыть CRM» в боте оповещений компании без пароля.

interface AccountsData {
  bot: { username: string; active: boolean } | null;
  accounts: { id: string; username: string | null; firstName: string | null; linked: boolean; linkedAt: string | null; lastLoginAt: string | null }[];
}

// Кнопка в шапке (2026-10-26: «привязку к Telegram в хэдере кнопкой — самолётик и текст, по нажатию
// попап, после привязки написано „привязано“»). className — внешний вид под шапку каждого дизайна.
export function TelegramHeaderButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const userId = useAuthStore((st) => st.user?.id);
  const { data } = useQuery({
    queryKey: ['telegram-accounts'],
    queryFn: async () => (await api.get<AccountsData>('/auth/telegram/accounts')).data,
    staleTime: 60_000,
  });
  // Пока статус грузится — последнее известное состояние из браузера, иначе при каждой перезагрузке
  // кнопка мигала «Привязать» → «привязан» (2026-10-26). Без сохранённого — нейтральный вид.
  const cacheKey = userId ? `tg-linked:${userId}` : null;
  const [cached, setCached] = useState<boolean | null>(null);
  useEffect(() => {
    if (!cacheKey) return;
    try {
      const v = localStorage.getItem(cacheKey);
      setCached(v === null ? null : v === '1');
    } catch {
      // приватный режим — без кэша
    }
  }, [cacheKey]);
  const fresh = data ? data.accounts.some((a) => a.linked) : null;
  useEffect(() => {
    if (fresh === null || !cacheKey) return;
    try {
      localStorage.setItem(cacheKey, fresh ? '1' : '0');
    } catch {
      // приватный режим — без кэша
    }
  }, [fresh, cacheKey]);
  const state = fresh ?? cached;
  const linked = state === true;
  const label = state === null ? 'Telegram' : linked ? 'Telegram привязан' : 'Привязать Telegram';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 h-9 text-sm font-medium shadow-sm transition-colors',
          linked || state === null
            ? 'bg-[#229ED9]/10 text-[#1C8AC0] dark:bg-[#229ED9]/15 dark:text-[#5CC1F0]'
            : 'bg-[#229ED9] text-white hover:bg-[#1C8AC0]',
          className,
        )}
      >
        <Send className="w-4 h-4" />
        <span className="hidden md:inline">{label}</span>
      </button>
      {open && <TelegramLoginDialog onClose={() => setOpen(false)} />}
    </>
  );
}

const errText = (err: unknown, fallback: string) => (isAxiosError(err) && err.response?.data?.error?.message) || fallback;

export function TelegramLoginDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['telegram-accounts'],
    queryFn: async () => (await api.get<AccountsData>('/auth/telegram/accounts')).data,
  });
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const setData = (d: AccountsData) => queryClient.setQueryData(['telegram-accounts'], d);

  const add = useMutation({
    mutationFn: async () => (await api.post<AccountsData>('/auth/telegram/accounts', { username })).data,
    onSuccess: (d) => {
      setData(d);
      setUsername('');
      setError('');
    },
    onError: (err) => setError(errText(err, 'Не удалось добавить')),
  });
  const makeLink = useMutation({
    mutationFn: async () => (await api.post<{ url: string }>('/auth/telegram/link')).data,
    onSuccess: (d) => {
      setLink(d.url);
      setError('');
      window.open(d.url, '_blank', 'noopener');
    },
    onError: (err) => setError(errText(err, 'Не удалось создать ссылку')),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete<AccountsData>(`/auth/telegram/accounts/${id}`)).data,
    onSuccess: setData,
    onError: (err) => setError(errText(err, 'Не удалось отвязать')),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Вход через Telegram</DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : !data.bot ? (
          <p className="text-sm text-muted-foreground">
            У компании ещё не подключён бот оповещений. Его подключает владелец в «Настройки → Оповещения» — после этого здесь можно будет
            привязать Telegram и открывать CRM прямо в нём.
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Привяжите свой Telegram — и CRM будет открываться в боте{' '}
              <a href={`https://t.me/${data.bot.username}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                @{data.bot.username}
              </a>{' '}
              кнопкой «Открыть CRM», без пароля. Можно привязать несколько аккаунтов.
            </p>

            {data.accounts.length > 0 && (
              <div className="divide-y rounded-lg border">
                {data.accounts.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{a.username ? `@${a.username}` : a.firstName || 'Telegram'}</div>
                      <div className={a.linked ? 'text-xs text-emerald-600 dark:text-emerald-400' : 'text-xs text-amber-600 dark:text-amber-400'}>
                        {a.linked ? (a.lastLoginAt ? `Привязан · последний вход ${new Date(a.lastLoginAt).toLocaleString('ru-RU')}` : 'Привязан') : 'Ждёт: откройте бота с этого аккаунта и нажмите «Старт»'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => confirm('Отвязать этот Telegram? Входить через него больше не получится.') && remove.mutate(a.id)}
                      className="p-1.5 rounded text-muted-foreground hover:text-red-500"
                      aria-label="Отвязать"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2 rounded-lg border p-3">
              <div className="font-medium">Способ 1 — подтвердить в боте (надёжнее)</div>
              <p className="text-xs text-muted-foreground">Откроется бот — нажмите «Старт» в том Telegram-аккаунте, который хотите привязать. Ссылка действует 15 минут.</p>
              <Button variant="outline" size="sm" disabled={makeLink.isPending} onClick={() => makeLink.mutate()}>
                <ExternalLink className="w-4 h-4 mr-1" /> Привязать через бота
              </Button>
              {link && (
                <p className="text-xs text-muted-foreground break-all">
                  Не открылось? Откройте ссылку на нужном устройстве:{' '}
                  <a href={link} target="_blank" rel="noopener noreferrer" className="text-primary">
                    {link}
                  </a>
                </p>
              )}
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <div className="font-medium">Способ 2 — по тегу</div>
              <p className="text-xs text-muted-foreground">
                Впишите @тег — аккаунт закрепится, как только его владелец откроет бота или CRM в нём. Потом тег можно менять: вход идёт по
                постоянному id.
              </p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (username.trim()) add.mutate();
                }}
              >
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@username" className="flex-1" />
                <Button type="submit" size="sm" disabled={!username.trim() || add.isPending}>
                  Добавить
                </Button>
              </form>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
