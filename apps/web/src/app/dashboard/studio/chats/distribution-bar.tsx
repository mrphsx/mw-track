'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ChevronDown, ChevronUp, Shuffle, UserRound, X } from 'lucide-react';
import { ChatSource, DistributionData, STAGE_TRIGGER_LABEL, fetchDistribution, saveAutoAssign, saveStageOperators } from '@/lib/chat';
import { cn } from '@/lib/utils';
import { triggerSummary } from './stages';

// «Кто ведёт лидов» — полоса над чатами для тимлида/админа/владельца (2026-10-25: «прямо на странице
// чата видно, кто сейчас оператор, сколько процентов, какой этап ему принадлежит, и легко поменять»).
// Новые чаты: если есть этап «Новый диалог» — его операторы, иначе авто-распределение ресурса.

type Rule = { userId: string; weight: number };
const OPEN_KEY = 'chat-distribution-open';

export function DistributionBar({ projectId, source }: { projectId: string; source: ChatSource }) {
  const { data } = useQuery({
    queryKey: ['chat-distribution', projectId, source],
    queryFn: () => fetchDistribution(projectId, source),
    refetchInterval: 30_000,
  });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === '1');
    } catch {
      // нет доступа к localStorage — полоса просто свёрнута
    }
  }, []);
  const toggle = () =>
    setOpen((v) => {
      try {
        localStorage.setItem(OPEN_KEY, v ? '0' : '1');
      } catch {
        // не сохранилось — не страшно
      }
      return !v;
    });

  if (!data) return null;
  const name = (id: string) => data.operators.find((o) => o.id === id)?.name ?? 'оператор';
  const rulesText = (rules: Rule[]) => (rules.length ? rules.map((r) => `${name(r.userId)} ${r.weight}%`).join(' · ') : 'никому');
  const otherStages = data.stages.filter((s) => !(data.newChats.kind === 'stage' && s.id === data.newChats.stageId));

  // Для каждого оператора: сколько ведёт сейчас и в каких правилах участвует.
  const perOperator = data.operators
    .map((o) => {
      const roles = [
        ...data.newChats.operators.filter((r) => r.userId === o.id).map((r) => `Новые ${r.weight}%`),
        ...otherStages.flatMap((s) => s.operators.filter((r) => r.userId === o.id).map((r) => `${s.name} ${r.weight}%`)),
      ];
      return { ...o, roles };
    })
    .filter((o) => o.activeChats > 0 || o.roles.length > 0);

  return (
    <div className="rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm">
      <button type="button" onClick={toggle} className="w-full flex items-center gap-3 px-4 py-2.5 text-left">
        <Shuffle className="w-4 h-4 shrink-0 text-[#1F4E9C] dark:text-[#7BA9EE]" />
        <span className="shrink-0 text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Кто ведёт лидов</span>
        <span className="min-w-0 flex-1 truncate text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
          Новые чаты → {rulesText(data.newChats.operators)}
          {otherStages
            .filter((s) => s.operators.length)
            .map((s) => ` │ ${s.name} → ${rulesText(s.operators)}`)
            .join('')}
        </span>
        {open ? <ChevronUp className="w-4 h-4 shrink-0 text-[#5F6B7A]" /> : <ChevronDown className="w-4 h-4 shrink-0 text-[#5F6B7A]" />}
      </button>

      {open && (
        <div className="border-t border-[#DCE1E8] dark:border-white/10 p-4 space-y-4">
          {perOperator.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {perOperator.map((o) => (
                <div key={o.id} className="inline-flex items-center gap-2 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2.5 py-1.5 text-xs">
                  <UserRound className="w-3.5 h-3.5 text-[#5F6B7A]" />
                  <span className={cn('font-medium text-[#131A24] dark:text-[#E9EDF3]', !o.isActive && 'line-through opacity-60')}>{o.name}</span>
                  <span className="text-[#5F6B7A] dark:text-[#92A0AF] tabular-nums">ведёт {o.activeChats}</span>
                  {o.roles.length > 0 && <span className="text-[#1F4E9C] dark:text-[#7BA9EE]">{o.roles.join(', ')}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <RuleCard
              projectId={projectId}
              source={source}
              data={data}
              title="Новые чаты"
              subtitle={
                data.newChats.kind === 'stage'
                  ? `через этап «${data.newChats.stageName}»`
                  : `каждый новый диалог ${source === 'PERSONAL' ? 'лички' : 'бота'} сразу получает оператора`
              }
              rules={data.newChats.operators}
              save={(rules) =>
                data.newChats.kind === 'stage' ? saveStageOperators(projectId, data.newChats.stageId, rules) : saveAutoAssign(projectId, data.resource, rules)
              }
            />
            {otherStages.map((s) => (
              <RuleCard
                key={s.id}
                projectId={projectId}
                source={source}
                data={data}
                title={s.name}
                color={s.color}
                subtitle={`этап · ${(s.trigger === 'TAG' || s.trigger === 'FIELD' ? STAGE_TRIGGER_LABEL[s.trigger] : triggerSummary({ ...s, fieldValue: null })).toLowerCase()}`}
                rules={s.operators}
                save={(rules) => saveStageOperators(projectId, s.id, rules)}
              />
            ))}
          </div>
          <p className="text-[11px] text-[#5F6B7A] dark:text-[#92A0AF]">
            Доли — вероятность: при 50/50 из 100 новых лидов примерно половина уйдёт каждому. Оператор видит только своих лидов, если у него не стоит
            «Видит все чаты» во вкладке «Операторы».
          </p>
        </div>
      )}
    </div>
  );
}

function RuleCard({
  projectId,
  source,
  data,
  title,
  subtitle,
  color,
  rules,
  save,
}: {
  projectId: string;
  source: ChatSource;
  data: DistributionData;
  title: string;
  subtitle: string;
  color?: string;
  rules: Rule[];
  save: (rules: Rule[]) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const savedKey = JSON.stringify([...rules].sort((a, b) => a.userId.localeCompare(b.userId)));
  const [draft, setDraft] = useState<Rule[]>(rules);
  const [error, setError] = useState('');
  useEffect(() => setDraft(JSON.parse(savedKey)), [savedKey]);

  const active = draft.filter((r) => r.weight > 0);
  const total = active.reduce((s, r) => s + r.weight, 0);
  const dirty = JSON.stringify([...active].sort((a, b) => a.userId.localeCompare(b.userId))) !== savedKey;
  const valid = active.length === 0 || total === 100;
  const available = useMemo(() => data.operators.filter((o) => o.isActive && !draft.some((r) => r.userId === o.id)), [data.operators, draft]);

  const mutation = useMutation({
    mutationFn: () => save(active),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['chat-distribution', projectId, source] });
      queryClient.invalidateQueries({ queryKey: ['chat-stages', projectId] });
      queryClient.invalidateQueries({ queryKey: ['chat-access', projectId] });
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить'),
  });

  const even = () => {
    if (!draft.length) return;
    const base = Math.floor(100 / draft.length);
    setDraft(draft.map((r, i) => ({ ...r, weight: base + (i < 100 - base * draft.length ? 1 : 0) })));
  };

  return (
    <div className="rounded-lg border border-[#DCE1E8] dark:border-white/10 p-3 space-y-2">
      <div className="flex items-center gap-2">
        {color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
        <span className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3] truncate">{title}</span>
      </div>
      <div className="text-[11px] text-[#5F6B7A] dark:text-[#92A0AF]">{subtitle}</div>
      {draft.length === 0 && <div className="text-xs text-amber-700 dark:text-amber-400">Никому не раздаётся — лидов увидят только тимлид и админы.</div>}
      <div className="space-y-1">
        {draft.map((r) => {
          const op = data.operators.find((o) => o.id === r.userId);
          return (
            <div key={r.userId} className="flex items-center gap-2">
              <span className={cn('min-w-0 flex-1 truncate text-sm text-[#131A24] dark:text-[#E9EDF3]', op && !op.isActive && 'line-through opacity-60')}>
                {op?.name ?? 'оператор'}
                <span className="ml-1 text-[11px] text-[#5F6B7A] tabular-nums">ведёт {op?.activeChats ?? 0}</span>
              </span>
              <input
                type="number"
                min={0}
                max={100}
                value={r.weight}
                onChange={(e) => {
                  const w = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
                  setDraft((prev) => prev.map((x) => (x.userId === r.userId ? { ...x, weight: w } : x)));
                }}
                className="h-7 w-14 rounded-md bg-[#F3F5F8] dark:bg-[#0F1620] px-1.5 text-right text-sm tabular-nums text-[#131A24] dark:text-[#E9EDF3] outline-none"
              />
              <span className="text-xs text-[#5F6B7A]">%</span>
              <button type="button" onClick={() => setDraft((prev) => prev.filter((x) => x.userId !== r.userId))} className="p-0.5 rounded text-[#5F6B7A] hover:text-red-600" aria-label="Убрать">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        {available.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && setDraft((prev) => [...prev, { userId: e.target.value, weight: 0 }])}
            className="h-7 min-w-0 flex-1 rounded-md bg-[#F3F5F8] dark:bg-[#0F1620] px-1.5 text-xs text-[#131A24] dark:text-[#E9EDF3] outline-none"
          >
            <option value="">+ оператор…</option>
            {available.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {!o.onProject ? ' (добавится в проект)' : ''}
              </option>
            ))}
          </select>
        )}
        {draft.length > 1 && (
          <button type="button" onClick={even} className="text-xs text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline">
            Поровну
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('text-[11px] tabular-nums', valid ? 'text-[#5F6B7A] dark:text-[#92A0AF]' : 'text-red-600 dark:text-red-400')}>
          {active.length ? `Сумма ${total}%${valid ? '' : ' — нужно 100%'}` : ''}
        </span>
        {dirty && (
          <button
            type="button"
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="h-7 px-3 rounded-md text-xs font-semibold bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] disabled:opacity-40"
          >
            {mutation.isPending ? 'Сохраняем…' : 'Сохранить'}
          </button>
        )}
      </div>
      {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}
