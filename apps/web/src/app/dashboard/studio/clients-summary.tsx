'use client';

// Сводка над списком клиентов (запрос пользователя 2026-10-21): сколько всего, сколько из них
// подписаны/отписались, дошли до диалога, что с ботом и сколько ФД/РД/сумма — по тем же
// фильтрам, что и таблица. Отдельный лёгкий запрос (GET .../clients/summary), идёт параллельно
// со списком и не задерживает его; пока считается — спокойная заглушка, а при смене фильтра
// старые цифры остаются видны полупрозрачными до прихода новых.

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ClientsSummary {
  total: number;
  subscribed: number;
  unsubscribed: number;
  external: number;
  dialogues: number;
  bot: { active: number; blocked: number; notActivated: number };
  fd: number;
  rd: number;
  revenue: number;
}

const fmt = (n: number) => n.toLocaleString('ru-RU');
const money = (n: number) => `$${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '');

export function StudioClientsSummary({
  projectId,
  params,
  enabled = true,
}: {
  projectId: string;
  params: Record<string, unknown>;
  enabled?: boolean;
}) {
  // У сайтов (ChannelType.WEBSITE) бота нет — группа «Бот» там бессмысленна.
  const { data: channelType } = useQuery({
    queryKey: ['project', projectId, 'channel-type'],
    queryFn: async () => (await api.get<{ channel: { type: string } | null }>(`/projects/${projectId}`)).data.channel?.type ?? null,
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  });
  const showBot = channelType !== 'WEBSITE';
  const { data, isFetching } = useQuery({
    queryKey: ['clients-summary', projectId, params],
    queryFn: async () => (await api.get<ClientsSummary>(`/projects/${projectId}/clients/summary`, { params })).data,
    enabled: enabled && !!projectId,
    placeholderData: keepPreviousData,
  });

  if (!data) {
    return (
      <div className="rounded-2xl border border-[#DCE1E8] dark:border-white/10 bg-white/60 dark:bg-[#171F2B]/60 px-4 py-3 text-xs text-[#5F6B7A] dark:text-[#92A0AF] animate-pulse">
        Подсчитываем сводку…
      </div>
    );
  }

  const t = data.total;
  return (
    <div
      className={`rounded-2xl border border-[#DCE1E8] dark:border-white/10 bg-white/60 dark:bg-[#171F2B]/60 px-4 py-3 transition-opacity ${isFetching ? 'opacity-60' : ''}`}
      title={isFetching ? 'Обновляем…' : undefined}
    >
      {/* Верхняя строка — главное: сколько клиентов и сколько они принесли. */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className="inline-flex items-baseline gap-1.5">
          <span className="text-lg font-semibold tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{fmt(t)}</span>
          <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">клиентов</span>
        </span>
        <span
          className="inline-flex items-baseline gap-3"
          title="Все покупки этих клиентов за всё время — как колонка «Потрачено» в таблице"
        >
          <span className="text-lg font-semibold tabular-nums text-[#1F4E9C] dark:text-[#7BA9EE]">{money(data.revenue)}</span>
          <Item label="ФД" value={data.fd} />
          <Item label="РД" value={data.rd} />
        </span>
      </div>
      {/* Нижняя строка — из чего состоит этот список. */}
      <div className="flex flex-wrap items-start gap-y-2 mt-2.5 pt-2.5 border-t border-[#DCE1E8]/70 dark:border-white/5">
        <Group label="Статус" first>
          <Item dot="bg-emerald-500" label="подписаны" value={data.subscribed} hint={pct(data.subscribed, t)} />
          <Item dot="bg-slate-400" label="отписались" value={data.unsubscribed} hint={pct(data.unsubscribed, t)} />
          {data.external > 0 && <Item dot="bg-slate-300" label="внешние" value={data.external} hint={pct(data.external, t)} />}
        </Group>
        <Group label="Диалог">
          <Item dot="bg-violet-500" label="написали" value={data.dialogues} hint={pct(data.dialogues, t)} />
        </Group>
        {showBot && (
          <Group label="Бот">
            <Item dot="bg-emerald-500" label="активен" value={data.bot.active} />
            <Item dot="bg-rose-400" label="заблокирован" value={data.bot.blocked} />
            <Item dot="bg-slate-300" label="не активирован" value={data.bot.notActivated} />
          </Group>
        )}
      </div>
    </div>
  );
}

// Разделитель — левая граница самой группы (кроме первой), а не отдельный элемент: при переносе
// на следующую строку не остаётся висящей черты в конце ряда.
function Group({ label, title, first, children }: { label: string; title?: string; first?: boolean; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 pr-5 ${first ? '' : 'pl-5 border-l border-[#DCE1E8] dark:border-white/10'}`} title={title}>
      <div className="text-[10px] uppercase tracking-wide text-[#8A95A3] dark:text-[#7D8A99] mb-1">{label}</div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">{children}</div>
    </div>
  );
}

function Item({ dot, label, value, hint }: { dot?: string; label: string; value: number; hint?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 text-sm whitespace-nowrap">
      {dot && <span className={`w-1.5 h-1.5 rounded-full self-center ${dot}`} />}
      <span className="font-semibold tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{fmt(value)}</span>
      <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">{label}</span>
      {hint && <span className="text-[11px] text-[#8A95A3] dark:text-[#7D8A99] tabular-nums">{hint}</span>}
    </span>
  );
}
