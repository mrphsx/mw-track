'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Eye, MessageCircle, MousePointerClick, Users, Wallet, LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { usePeriodQueryState } from '@/lib/use-period-query-state';
import { PROTOTYPE_PERIOD_OPTIONS, previewLanding } from '@/lib/prototype-project-data';
import { STUDIO_CARD } from '../../../../ui';
import { STUDIO_HUES, StudioHueName } from '../../../../colors';

const CATEGORIES = ['buyers', 'pixels', 'landings', 'campaigns', 'sources'] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_TITLE: Record<Category, string> = {
  buyers: 'Баеры',
  pixels: 'Пиксели',
  landings: 'Лендинги',
  campaigns: 'Кампании',
  sources: 'Источники',
};
const CLIENTS_COLUMN_LABEL: Record<Category, string> = {
  buyers: 'клиентов',
  pixels: 'клиентов',
  landings: 'подписчиков',
  campaigns: 'клиентов',
  sources: 'клиентов',
};
const SOURCE_LABEL: Record<string, string> = { FACEBOOK: 'Facebook', TIKTOK: 'TikTok' };

interface LeaderboardFullItem {
  id: string;
  name: string;
  isDeleted?: boolean;
  clients: number;
  revenue: number;
}

// Та же форма и тот же компонент воронки, что и в ТОП-разделе страницы проекта (запрос
// пользователя 2026-08-19: "забыл добавить всю информацию про конверсию, как это есть в разделе
// ТОП") — скопировано из studio/projects/[id]/page.tsx (LeaderboardFunnelRow/LeaderboardFunnelMini
// в цветах Studio), не импортировано оттуда — тот же принцип, что и у остальных небольших
// дублирований между связанными страницами в этом дереве.
interface LeaderboardFunnelRow {
  id: string;
  pageViews?: number;
  leads?: number;
  subscribes: number;
  dialogues: number;
  purchases: number;
  revenue: number;
}

function LeaderboardFunnelMini({ row }: { row: LeaderboardFunnelRow }) {
  const stages: { key: string; icon: LucideIcon; hue: StudioHueName; count: number }[] = [];
  if (row.pageViews !== undefined) stages.push({ key: 'pageViews', icon: Eye, hue: 'slate', count: row.pageViews });
  if (row.leads !== undefined) stages.push({ key: 'leads', icon: MousePointerClick, hue: 'teal', count: row.leads });
  stages.push({ key: 'subscribes', icon: Users, hue: 'amber', count: row.subscribes });
  stages.push({ key: 'dialogues', icon: MessageCircle, hue: 'plum', count: row.dialogues });
  stages.push({ key: 'purchases', icon: Wallet, hue: 'sage', count: row.purchases });

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[#5F6B7A] dark:text-[#92A0AF] mt-1.5 pt-1.5 border-t border-[#DCE1E8] dark:border-white/10">
      {stages.map((stage, i) => {
        const prev = stages[i - 1];
        const rate = prev && prev.count > 0 ? Math.round((stage.count / prev.count) * 100) : undefined;
        const Icon = stage.icon;
        return (
          <Fragment key={stage.key}>
            {i > 0 && <ChevronRight className="w-3 h-3 shrink-0" />}
            <span className="inline-flex items-center gap-0.5 shrink-0" title={rate !== undefined ? `${rate}% от предыдущего шага` : undefined}>
              <Icon className={`w-3 h-3 shrink-0 ${STUDIO_HUES[stage.hue].textClass}`} />
              {stage.count}
              {rate !== undefined && <span className="text-[10px]">({rate}%)</span>}
            </span>
          </Fragment>
        );
      })}
      {row.revenue > 0 && <span className="font-medium text-[#131A24] dark:text-[#E9EDF3] shrink-0">${row.revenue.toFixed(2)}</span>}
    </div>
  );
}

// Studio-версия полного списка одной категории лидерборда — "Сравнить все" со страницы проекта
// (запрос пользователя 2026-08-19). Логика 1:1 с classic (apps/web/.../(dashboard)/projects/[id]/
// leaderboards/[category]/page.tsx), период-пилюли скопированы из самой страницы проекта (та же
// причина, что и там — не вынесено в общий компонент, страница проекта уже рабочая).
export default function StudioLeaderboardFullPage() {
  const { id, category } = useParams<{ id: string; category: string }>();
  const [period, setPeriod] = usePeriodQueryState('today');

  const periodReady = period.period !== 'custom' || (!!period.from && !!period.to);
  const periodParams = period.period === 'custom' ? { period: period.period, from: period.from, to: period.to } : { period: period.period };

  const isValidCategory = (CATEGORIES as readonly string[]).includes(category);

  const { data } = useQuery({
    queryKey: ['project', id, 'leaderboards', category, 'full', periodParams],
    queryFn: async () =>
      (await api.get<{ items: LeaderboardFullItem[] }>(`/projects/${id}/leaderboards/${category}/full`, { params: periodParams })).data.items,
    enabled: periodReady && isValidCategory,
  });

  // Воронка для ВСЕХ строк полного списка сразу (не только top-5) — тот же эндпоинт .../funnel,
  // потолок ids поднят там же с 10 до 200 под этот кейс.
  const ids = (data ?? []).map((item) => item.id);
  const { data: funnel } = useQuery({
    queryKey: ['project', id, 'leaderboards', category, 'full-funnel', periodParams, ids.join(',')],
    queryFn: async () =>
      (
        await api.get<{ items: LeaderboardFunnelRow[] }>(`/projects/${id}/leaderboards/${category}/funnel`, {
          params: { ...periodParams, ids: ids.join(',') },
        })
      ).data.items,
    enabled: periodReady && isValidCategory && ids.length > 0,
  });
  const funnelById = new Map((funnel ?? []).map((r) => [r.id, r]));

  if (!isValidCategory) return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Неизвестная категория.</p>;
  const cat = category as Category;
  const displayName = (item: LeaderboardFullItem) => (cat === 'sources' ? SOURCE_LABEL[item.name] || item.name : item.name);

  return (
    <div className="space-y-4">
      <Link
        href={`/projects/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Назад к проекту
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">{CATEGORY_TITLE[cat]} — сравнение</h1>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-1 gap-0.5">
            {PROTOTYPE_PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPeriod({ period: opt.value })}
                className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
                  period.period === opt.value
                    ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                    : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
                }`}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPeriod({ period: 'custom', from: period.from, to: period.to })}
              className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
                period.period === 'custom'
                  ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                  : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
              }`}
            >
              Период
            </button>
          </div>
          {period.period === 'custom' && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={period.from ?? ''}
                max={period.to || undefined}
                onChange={(e) => setPeriod({ period: 'custom', from: e.target.value, to: period.to })}
                className="w-auto rounded-lg bg-white dark:bg-[#171F2B] dark:border-white/10 shadow-sm"
              />
              <span className="text-[#5F6B7A] dark:text-[#92A0AF] text-sm">—</span>
              <Input
                type="date"
                value={period.to ?? ''}
                min={period.from || undefined}
                onChange={(e) => setPeriod({ period: 'custom', from: period.from, to: e.target.value })}
                className="w-auto rounded-lg bg-white dark:bg-[#171F2B] dark:border-white/10 shadow-sm"
              />
            </div>
          )}
        </div>
      </div>

      <div className={`${STUDIO_CARD} p-5`}>
        <h3 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-3">Всего: {data?.length ?? '—'}</h3>
        {data?.length === 0 && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Нет данных за период.</p>}
        <div className="space-y-3">
          {data?.map((item, i) => {
            const itemFunnel = funnelById.get(item.id);
            return (
              <div key={item.id}>
                <div className="flex items-center justify-between text-sm gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[#5F6B7A] dark:text-[#92A0AF] shrink-0">{i + 1}.</span>
                    {/* Клик по названию ведёт на страницу лендинга, отдельная иконка — превью
                        (запрос пользователя 2026-08-20, "точь-в-точь как в разделе ТОП"). */}
                    {cat === 'landings' ? (
                      <Link href={`/projects/${id}/landings/${item.id}`} className="truncate hover:underline text-[#131A24] dark:text-[#E9EDF3]">
                        {displayName(item)}
                      </Link>
                    ) : (
                      <span
                        className={`truncate ${item.isDeleted ? 'text-red-600 dark:text-red-400' : 'text-[#131A24] dark:text-[#E9EDF3]'}`}
                        title={item.isDeleted ? 'Удалённый пользователь' : undefined}
                      >
                        {displayName(item)}
                      </span>
                    )}
                    {cat === 'landings' && (
                      <button
                        type="button"
                        onClick={() => previewLanding(item.id)}
                        className="shrink-0 text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]"
                        title="Предпросмотр лендинга"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-medium text-[#131A24] dark:text-[#E9EDF3]">${item.revenue.toFixed(2)}</div>
                    <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                      {item.clients} {CLIENTS_COLUMN_LABEL[cat]}
                    </div>
                  </div>
                </div>
                {itemFunnel && <LeaderboardFunnelMini row={itemFunnel} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
