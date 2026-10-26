'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { AlertTriangle, ArrowRight, Bot, MessageCircle, Radio, User, Wallet, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';
import {
  ENTRY_LABEL,
  FunnelConfig,
  LEAD_BOT_START_LABEL,
  LeadBotStart,
  fetchProjectFunnel,
  saveProjectFunnel,
} from '@/lib/funnel';
import { Switch } from '@/components/ui/switch';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../../../ui';

const MUTED = 'text-[#5F6B7A] dark:text-[#92A0AF]';
const FG = 'text-[#131A24] dark:text-[#E9EDF3]';

interface StatsStage {
  stage: string;
  count: number;
}

// Вкладка «Воронка» (запрос пользователя 2026-10-24): что считается лидом и диалогом —
// явной настройкой, а не неявно из «способа вступления». Пока проект её не сохранял, показывается
// и действует прежняя логика (ProjectFunnel.defaults). Сохранение применяется к новым событиям,
// прошлая статистика не пересчитывается.
export function FunnelTab({ projectId, onOpenConnections }: { projectId: string; onOpenConnections: () => void }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canEdit = hasPermission(user, projectId, 'PROJECTS_EDIT');
  const [draft, setDraft] = useState<FunnelConfig | null>(null);
  const [error, setError] = useState('');

  const { data: funnel } = useQuery({ queryKey: ['project-funnel', projectId], queryFn: () => fetchProjectFunnel(projectId) });
  const { data: stats } = useQuery({
    queryKey: ['project-funnel-stats', projectId],
    queryFn: async () => (await api.get<StatsStage[]>(`/projects/${projectId}/clients/funnel`, { params: { period: '7d' } })).data,
    retry: false,
  });

  useEffect(() => {
    if (funnel) setDraft(funnel.config);
  }, [funnel]);

  const save = useMutation({
    mutationFn: (config: FunnelConfig | null) => saveProjectFunnel(projectId, config),
    onSuccess: (data) => {
      queryClient.setQueryData(['project-funnel', projectId], data);
      queryClient.invalidateQueries({ queryKey: ['project-funnel-stats', projectId] });
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить'),
  });

  if (!funnel || !draft) return <p className={`text-sm ${MUTED}`}>Загрузка...</p>;

  const { connections } = funnel;
  const isTelegram = connections.type === 'TELEGRAM';
  const isPrivateChannel = connections.mode === 'PRIVATE_CHANNEL_REQUEST';
  const dirty = JSON.stringify(draft) !== JSON.stringify(funnel.config);
  const set = <K extends keyof FunnelConfig>(key: K, value: FunnelConfig[K]) => setDraft({ ...draft, [key]: value });
  const count = (stage: string) => stats?.find((s) => s.stage === stage)?.count;

  if (!isTelegram) {
    return (
      <div className={`${STUDIO_CARD} p-5 text-sm ${MUTED}`}>
        У проекта без Telegram воронка фиксированная: клиент появляется в момент покупки на сайте.
      </div>
    );
  }

  const leadSources = [
    isPrivateChannel || (draft.leadChannelJoin === 'ANY' && connections.hasChannel),
    connections.hasBot && draft.leadBotStart !== 'OFF',
    connections.hasPersonal && draft.leadPersonalMessage,
  ].filter(Boolean).length;
  const dialogueSources = [connections.hasBot && draft.dialogueBotMessage, connections.hasPersonal && draft.dialoguePersonalMessage].filter(Boolean).length;
  // Код лендинга в Start и ссылки на бота есть только в режиме «Сразу в бота» — в остальных
  // режимах лендинг ведёт не в бота, и варианты TRACKED/LINKS ничего бы не засчитали.
  const botStartOptions: LeadBotStart[] = connections.mode === 'BOT_DIRECT' ? ['ALL', 'TRACKED', 'LINKS', 'OFF'] : ['ALL', 'OFF'];

  return (
    <div className="space-y-5">
      <div className={`${STUDIO_CARD} p-4 flex flex-wrap items-center justify-between gap-3`}>
        <div className={`text-sm ${MUTED} max-w-3xl`}>
          Здесь задаётся, кого считать лидом и с какого момента начинается диалог — от этого зависят статистика проекта,
          события в пикселях и запуск автоворонок. Изменения действуют для новых событий, прошлые цифры не пересчитываются.
        </div>
        <StudioPill hue={funnel.isCustom ? 'amber' : 'slate'}>{funnel.isCustom ? 'Настроено вручную' : 'Стандартная настройка'}</StudioPill>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1.4fr_auto_1.2fr_auto_1fr] items-stretch">
        <Stage icon={Radio} title="Вход">
          <p className={`text-sm ${FG}`}>Лендинг и реклама ведут {ENTRY_LABEL[connections.mode ?? ''] ?? '—'}.</p>
          <button type="button" onClick={onOpenConnections} className="text-xs font-medium text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline">
            Изменить в «Подключениях»
          </button>
        </Stage>

        <Arrow />

        <Stage icon={User} title="Лид" metric={count('Subscribe')} metricLabel={funnel.leadLabel}>
          {isPrivateChannel && <Fixed text="Заявка в канал по нашей ссылке — всегда" />}
          {connections.hasChannel && (
            <Toggle
              label={isPrivateChannel ? 'Вступление в канал по любой другой ссылке' : 'Вступление в канал'}
              hint={isPrivateChannel ? 'Обычно выключено: чужие ссылки — не наш трафик' : 'Включает любого вступившего, даже мимо бота и лендинга'}
              checked={draft.leadChannelJoin === 'ANY'}
              disabled={!canEdit}
              onChange={(v) => set('leadChannelJoin', v ? 'ANY' : 'OFF')}
            />
          )}
          {connections.hasBot && (
            <div className="space-y-1.5">
              <div className={`text-sm font-medium ${FG} flex items-center gap-1.5`}>
                <Bot className="w-3.5 h-3.5" /> Start в боте
              </div>
              {botStartOptions.map((opt) => (
                <label key={opt} className={`flex items-start gap-2 text-sm ${canEdit ? 'cursor-pointer' : 'opacity-70'}`}>
                  <input
                    type="radio"
                    className="mt-1"
                    disabled={!canEdit}
                    checked={draft.leadBotStart === opt}
                    onChange={() => set('leadBotStart', opt)}
                  />
                  <span className={FG}>{LEAD_BOT_START_LABEL[opt]}</span>
                </label>
              ))}
            </div>
          )}
          {connections.hasPersonal && (
            <Toggle
              label="Первое сообщение в личку"
              hint="Человек сам написал в подключённый личный аккаунт"
              checked={draft.leadPersonalMessage}
              disabled={!canEdit}
              onChange={(v) => set('leadPersonalMessage', v)}
            />
          )}
          {leadSources === 0 && <Warning text="Ни один источник не делает лидом — новые клиенты не попадут в статистику проекта." />}
        </Stage>

        <Arrow />

        <Stage icon={MessageCircle} title="Диалог" metric={count('Dialogue')} metricLabel="Начали диалог">
          {connections.hasBot && (
            <Toggle
              label="Сообщение боту, включая Start"
              hint="Сам бот и есть переписка"
              checked={draft.dialogueBotMessage}
              disabled={!canEdit}
              onChange={(v) => set('dialogueBotMessage', v)}
            />
          )}
          {connections.hasPersonal ? (
            <Toggle
              label="Сообщение в личку"
              hint="Клиент написал в подключённый личный аккаунт"
              checked={draft.dialoguePersonalMessage}
              disabled={!canEdit}
              onChange={(v) => set('dialoguePersonalMessage', v)}
            />
          ) : (
            <p className={`text-xs ${MUTED}`}>Личка не подключена — диалоги из неё появятся, когда её подключат в «Подключениях».</p>
          )}
          <Fixed text="Отметка менеджера и кнопка «Зарегистрировать» в CRM — всегда" />
          {connections.hasBot && connections.hasPersonal && draft.dialogueBotMessage && draft.dialoguePersonalMessage && (
            <Warning text="Включены оба источника: засчитается тот, что случится раньше. Если настоящий разговор идёт в личке, сообщение боту лучше выключить." />
          )}
          {dialogueSources === 0 && <p className={`text-xs ${MUTED}`}>Диалоги будут только по отметке менеджера.</p>}
        </Stage>

        <Arrow />

        <Stage icon={Wallet} title="Депозит" metric={count('FirstDeposit')} metricLabel="Первые депозиты">
          <Fixed text="Регистрируется вручную в CRM, менеджером через бота или командой /purchase" />
        </Stage>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <StudioLinkButton variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
            {save.isPending ? 'Сохраняем…' : 'Сохранить воронку'}
          </StudioLinkButton>
          {dirty && (
            <StudioLinkButton onClick={() => setDraft(funnel.config)} disabled={save.isPending}>
              Отменить изменения
            </StudioLinkButton>
          )}
          {funnel.isCustom && !dirty && (
            <StudioLinkButton
              onClick={() => confirm('Вернуть стандартную настройку воронки для этого проекта?') && save.mutate(null)}
              disabled={save.isPending}
            >
              Вернуть стандартную
            </StudioLinkButton>
          )}
          <span className={`text-xs ${MUTED}`}>Цифры на этапах — за последние 7 дней.</span>
        </div>
      ) : (
        <p className={`text-xs ${MUTED}`}>Менять воронку может сотрудник с правом на редактирование проекта.</p>
      )}
    </div>
  );
}

function Stage({
  icon: Icon,
  title,
  metric,
  metricLabel,
  children,
}: {
  icon: LucideIcon;
  title: string;
  metric?: number;
  metricLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${STUDIO_CARD} p-4 flex flex-col gap-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${MUTED}`}>
          <Icon className="w-3.5 h-3.5" /> {title}
        </div>
        {metric !== undefined && (
          <div className="text-right">
            <div className={`text-lg font-bold tabular-nums leading-none ${FG}`}>{metric}</div>
            {metricLabel && <div className={`text-[10px] ${MUTED}`}>{metricLabel}</div>}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Arrow() {
  return (
    <div className="hidden lg:flex items-center justify-center">
      <ArrowRight className="w-4 h-4 text-[#5F6B7A] dark:text-[#92A0AF]" />
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className={`text-sm font-medium ${FG}`}>{label}</div>
        {hint && <div className={`text-xs ${MUTED}`}>{hint}</div>}
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function Fixed({ text }: { text: string }) {
  return <div className={`text-xs ${MUTED} rounded-md bg-[#F3F5F8] dark:bg-[#0F1620] px-2.5 py-1.5`}>{text}</div>;
}

function Warning({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {text}
    </div>
  );
}
