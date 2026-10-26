'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Check, CheckCircle2, Copy, Loader2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { BotScenarioListItem } from '@/lib/scenarios';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StudioLinkButton } from '../../../ui';
import { EditChannelDialog } from './tabs';

// Диалоги настроек ботов для плиток «Подключений» (запрос пользователя 2026-10-24: «маленькие, а
// при нажатии настроек откроется его настройка… менеджеры тоже отдельная кнопка»).

const MUTED = 'text-[#5F6B7A] dark:text-[#92A0AF]';
const FG = 'text-[#131A24] dark:text-[#E9EDF3]';
const LINK = 'text-xs font-medium text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline';

export interface PrimaryBotSettings {
  tgBotToken: string | null;
  tgBotUsername: string | null;
  tgBotFirstName: string | null;
  tgMode: string | null;
  tgChannelId: string | null;
  tgChannelUsername: string | null;
  tgJoinDelaySeconds: number | null;
  tgManagerUsernames: string[] | null;
}

export interface ExtraBot {
  id: string;
  tgBotUsername: string | null;
  tgBotFirstName: string | null;
  tgManagerUsernames: string[];
  isActive: boolean;
  lastError: string | null;
  lastWebhookAt: string | null;
  subscribers: number;
}

export const errorMessage = (err: unknown, fallback: string) => (isAxiosError(err) && err.response?.data?.error?.message) || fallback;

const parseUsernames = (text: string) => Array.from(new Set(text.split(/[\s,]+/).map((u) => u.trim().replace(/^@/, '')).filter(Boolean)));

export function usePrimaryBot(channelId: string) {
  return useQuery({
    queryKey: ['channel', channelId, 'bot-settings'],
    queryFn: async () => (await api.get<PrimaryBotSettings>(`/channels/${channelId}`)).data,
    enabled: !!channelId,
  });
}

// Права основного бота в канале — нужны, чтобы принимать заявки и видеть вступления.
export function useChannelAdminCheck(channelId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['channel', channelId, 'health'],
    queryFn: async () => (await api.get<{ healthy: boolean; message?: string }>(`/channels/${channelId}/health`)).data,
    enabled: enabled && !!channelId,
    staleTime: 60_000,
  });
}

export function PrimaryBotSettingsDialog({
  projectId,
  channelId,
  canManage,
  onClose,
}: {
  projectId: string;
  channelId: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [editingToken, setEditingToken] = useState(false);
  const { data: bot } = usePrimaryBot(channelId);
  const acceptsRequests = bot?.tgMode === 'PRIVATE_CHANNEL_REQUEST';
  const { data: health, isFetching: checking, refetch } = useChannelAdminCheck(channelId, !!bot?.tgChannelId);
  const { data: scenarios } = useQuery({
    queryKey: ['channel', channelId, 'scenarios'],
    queryFn: async () => (await api.get<BotScenarioListItem[]>(`/channels/${channelId}/scenarios`)).data,
  });
  const patch = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/channels/${channelId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel', channelId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  const welcome = scenarios?.find((s) => s.triggerType === 'SUBSCRIBE');
  const welcomeOn = !!welcome && welcome.isActive && welcome.stepCount > 0;

  return (
    <>
      <Dialog open={!editingToken} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Основной бот {bot?.tgBotUsername ? `@${bot.tgBotUsername}` : ''}</DialogTitle>
          </DialogHeader>
          {!bot ? (
            <p className={`text-sm ${MUTED}`}>Загрузка…</p>
          ) : (
            <div className="divide-y divide-[#DCE1E8] dark:divide-white/10 -mx-1">
              <Row label="Токен">
                <TokenValue token={bot.tgBotToken} />
                {canManage && (
                  <button type="button" className={LINK} onClick={() => setEditingToken(true)}>
                    Сменить
                  </button>
                )}
              </Row>
              {bot.tgChannelId && (
                <Row label="Права в канале">
                  {checking ? (
                    <Loader2 className={`w-3.5 h-3.5 animate-spin ${MUTED}`} />
                  ) : health?.healthy ? (
                    <span className="text-sm text-emerald-600 dark:text-emerald-400">админ, может одобрять заявки</span>
                  ) : (
                    <span className="text-sm text-red-600 dark:text-red-400">{health?.message || 'нет прав администратора'}</span>
                  )}
                  <button type="button" className={LINK} onClick={() => refetch()} disabled={checking}>
                    Проверить
                  </button>
                </Row>
              )}
              {acceptsRequests && (
                <JoinDelayRow
                  value={bot.tgJoinDelaySeconds ?? 0}
                  disabled={!canManage}
                  saving={patch.isPending}
                  onSave={(seconds) => patch.mutate({ tgJoinDelaySeconds: seconds })}
                />
              )}
              <Row label="Приветствие">
                {welcomeOn ? (
                  <span className={`inline-flex items-center gap-1 text-sm ${FG}`}>
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#1F7A6C] dark:text-[#6FCBBA]" />
                    {acceptsRequests ? 'при одобрении заявки' : 'когда человек становится лидом'}
                  </span>
                ) : (
                  <span className={`inline-flex items-center gap-1 text-sm ${MUTED}`}>
                    <XCircle className="w-3.5 h-3.5" /> не настроено
                  </span>
                )}
                <Link className={LINK} href={welcome ? `/projects/${projectId}/scenarios/${welcome.id}` : `/projects/${projectId}/scenarios`}>
                  Сценарии
                </Link>
              </Row>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <EditChannelDialog
        channelId={editingToken ? channelId : null}
        projectId={projectId}
        onClose={() => setEditingToken(false)}
      />
    </>
  );
}

// Менеджеры бота — общий диалог для основного и дополнительных ботов.
export function ManagersDialog({
  title,
  managers,
  canManage,
  onSave,
  onClose,
}: {
  title: string;
  managers: string[];
  canManage: boolean;
  onSave: (list: string[]) => Promise<unknown>;
  onClose: () => void;
}) {
  const [text, setText] = useState(managers.join('\n'));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(managers.join('\n')), [managers]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className={`text-sm ${MUTED}`}>
            По одному Telegram-username на строку. Менеджер пересылает боту сообщение клиента (или его @username, ссылку, ID) и выбирает
            «Диалог» или «Покупка». Менеджеры клиентами не считаются. Пусто — бот не менеджерский.
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!canManage}
            rows={5}
            className="font-mono text-sm"
            placeholder={'ivan_manager\nmaria_support'}
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <StudioLinkButton onClick={onClose}>Закрыть</StudioLinkButton>
            {canManage && (
              <StudioLinkButton
                variant="primary"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onSave(parseUsernames(text));
                    onClose();
                  } catch (err) {
                    setError(errorMessage(err, 'Не удалось сохранить'));
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </StudioLinkButton>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ExtraBotSettingsDialog({ projectId, bot, onClose }: { projectId: string; bot: ExtraBot; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['project', projectId, 'extra-bots'] });
  const reconnect = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/bots/${bot.id}/reconnect`),
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: (err) => setError(errorMessage(err, 'Не удалось переподключить')),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}/bots/${bot.id}`),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (err) => setError(errorMessage(err, 'Не удалось отключить')),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Бот {bot.tgBotUsername ? `@${bot.tgBotUsername}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className={`text-sm ${MUTED}`}>
            Дополнительный бот: свои сценарии, чат, менеджеры и подписчики ({bot.subscribers}). Заявки в канал не принимает, на статус бота у
            клиента не влияет.
          </p>
          {bot.lastError && <p className="text-sm text-red-600 dark:text-red-400">{bot.lastError}</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <StudioLinkButton disabled={reconnect.isPending} onClick={() => reconnect.mutate()}>
              {reconnect.isPending ? 'Подключаем…' : 'Переподключить'}
            </StudioLinkButton>
            <StudioLinkButton
              disabled={remove.isPending}
              onClick={() => confirm(`Отключить бота @${bot.tgBotUsername ?? ''}? Переписка и подписчики останутся в истории.`) && remove.mutate()}
            >
              Отключить
            </StudioLinkButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AddBotDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [check, setCheck] = useState<{ ok: boolean; text: string; warning?: string | null } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const runCheck = async () => {
    setChecking(true);
    setError('');
    try {
      const { data } = await api.post<{ username?: string; firstName: string; warning: string | null }>('/channels/check-bot-token', { token: token.trim() });
      setCheck({ ok: true, text: `${data.firstName}${data.username ? ` (@${data.username})` : ''}`, warning: data.warning });
    } catch (err) {
      setCheck({ ok: false, text: errorMessage(err, 'Не удалось проверить токен') });
    } finally {
      setChecking(false);
    }
  };

  const add = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/bots`, { token: token.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'extra-bots'] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err, 'Не удалось подключить бота')),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Добавить бота</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className={`text-sm ${MUTED}`}>
            Создайте бота в @BotFather и вставьте токен. У бота будут свои сценарии, чат и менеджеры. Заявки в канал по-прежнему принимает
            основной бот.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="extra-bot-token">Токен бота</Label>
            <Input
              id="extra-bot-token"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setCheck(null);
              }}
              placeholder="123456:ABC-..."
            />
          </div>
          <StudioLinkButton size="sm" disabled={!token.trim() || checking} onClick={runCheck}>
            {checking ? 'Проверяем…' : 'Проверить токен'}
          </StudioLinkButton>
          {check && (
            <div className={`text-sm ${check.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
              {check.ok ? `Токен рабочий: ${check.text}` : check.text}
              {check.warning && <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">{check.warning}</div>}
            </div>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <StudioLinkButton onClick={onClose}>Отмена</StudioLinkButton>
            <StudioLinkButton variant="primary" disabled={!check?.ok || !!check.warning || add.isPending} onClick={() => add.mutate()}>
              {add.isPending ? 'Подключаем…' : 'Подключить'}
            </StudioLinkButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 py-2.5">
      <div className={`w-32 shrink-0 text-xs font-medium ${MUTED}`}>{label}</div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0 flex-1">{children}</div>
    </div>
  );
}

function TokenValue({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!token) return <span className={`text-sm ${MUTED}`}>не задан</span>;
  const masked = `${token.split(':')[0]}:••••${token.slice(-4)}`;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`font-mono text-sm ${FG}`}>{masked}</span>
      <button
        type="button"
        title="Скопировать токен"
        onClick={async () => {
          await copyToClipboard(token);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className={MUTED}
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </span>
  );
}

function JoinDelayRow({ value, disabled, saving, onSave }: { value: number; disabled: boolean; saving: boolean; onSave: (seconds: number) => void }) {
  const [seconds, setSeconds] = useState(String(value));
  useEffect(() => setSeconds(String(value)), [value]);
  const changed = (Number(seconds) || 0) !== value;
  return (
    <Row label="Задержка одобрения">
      <Input type="number" min={0} max={3600} value={seconds} disabled={disabled} onChange={(e) => setSeconds(e.target.value)} className="h-8 w-24" />
      <span className={`text-xs ${MUTED}`}>сек.</span>
      {changed && !disabled && (
        <button type="button" className={LINK} disabled={saving} onClick={() => onSave(Math.min(3600, Math.max(0, Number(seconds) || 0)))}>
          Сохранить
        </button>
      )}
    </Row>
  );
}
