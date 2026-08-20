'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Eye, MessageCircle, MousePointerClick, Users, Wallet, LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PeriodSelector } from '@/components/shared/period-selector';
import { usePeriodQueryState } from '@/lib/use-period-query-state';

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

// Предпросмотр лендинга (запрос пользователя 2026-08-20: "надо чтобы можно было открыть превью
// как это сделано в Топ Лэндинги") — тот же паттерн, что и на странице проекта (см. её
// previewLanding): GET /landings/:id/preview требует JWT, обычный <a href> не сработает.
const previewLanding = async (landingId: string) => {
  const res = await api.get(`/landings/${landingId}/preview`, { responseType: 'text' });
  const blob = new Blob([res.data as string], { type: 'text/html' });
  window.open(URL.createObjectURL(blob), '_blank');
};

interface LeaderboardFullItem {
  id: string;
  name: string;
  isDeleted?: boolean;
  clients: number;
  revenue: number;
}

// Та же форма и тот же компонент воронки, что и в ТОП-разделе страницы проекта (запрос
// пользователя 2026-08-19: "забыл добавить всю информацию про конверсию, как это есть в разделе
// ТОП") — скопировано из apps/web/.../(dashboard)/projects/[id]/page.tsx (LeaderboardFunnelRow/
// LeaderboardFunnelMini), не импортировано оттуда: страницы App Router не переиспользуют друг
// друга напрямую в этом кодбейзе, тот же принцип, что и у остальных небольших дублирований между
// связанными страницами.
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
  const stages: { key: string; icon: LucideIcon; color: string; count: number }[] = [];
  if (row.pageViews !== undefined) stages.push({ key: 'pageViews', icon: Eye, color: '#7c3aed', count: row.pageViews });
  if (row.leads !== undefined) stages.push({ key: 'leads', icon: MousePointerClick, color: '#0891b2', count: row.leads });
  stages.push({ key: 'subscribes', icon: Users, color: '#2563eb', count: row.subscribes });
  stages.push({ key: 'dialogues', icon: MessageCircle, color: '#16a34a', count: row.dialogues });
  stages.push({ key: 'purchases', icon: Wallet, color: '#d97706', count: row.purchases });

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground mt-1.5 pt-1.5 border-t">
      {stages.map((stage, i) => {
        const prev = stages[i - 1];
        const rate = prev && prev.count > 0 ? Math.round((stage.count / prev.count) * 100) : undefined;
        const Icon = stage.icon;
        return (
          <Fragment key={stage.key}>
            {i > 0 && <ChevronRight className="w-3 h-3 shrink-0" />}
            <span className="inline-flex items-center gap-0.5 shrink-0" title={rate !== undefined ? `${rate}% от предыдущего шага` : undefined}>
              <Icon className="w-3 h-3 shrink-0" style={{ color: stage.color }} />
              {stage.count}
              {rate !== undefined && <span className="text-[10px]">({rate}%)</span>}
            </span>
          </Fragment>
        );
      })}
      {row.revenue > 0 && <span className="font-medium text-foreground shrink-0">${row.revenue.toFixed(2)}</span>}
    </div>
  );
}

// Полный список одной категории лидерборда — "Сравнить все" со страницы проекта (запрос
// пользователя 2026-08-19: "под каждым топ разделом кнопка на отдельную страницу со списком всех
// записей для сравнения конверсии, так же нужен выбор периода как на главной странице проекта").
// Тот же usePeriodQueryState, что и у самой страницы проекта — период сохраняется в URL и не
// сбрасывается при обновлении.
export default function LeaderboardFullPage() {
  const { id, category } = useParams<{ id: string; category: string }>();
  const [periodValue, setPeriodValue] = usePeriodQueryState('today');

  const periodReady = periodValue.period !== 'custom' || (!!periodValue.from && !!periodValue.to);
  const periodParams =
    periodValue.period === 'custom' ? { period: periodValue.period, from: periodValue.from, to: periodValue.to } : { period: periodValue.period };

  const isValidCategory = (CATEGORIES as readonly string[]).includes(category);

  const { data } = useQuery({
    queryKey: ['project', id, 'leaderboards', category, 'full', periodParams],
    queryFn: async () =>
      (await api.get<{ items: LeaderboardFullItem[] }>(`/projects/${id}/leaderboards/${category}/full`, { params: periodParams })).data.items,
    enabled: periodReady && isValidCategory,
  });

  // Воронка для ВСЕХ строк полного списка сразу (не только top-5, как на странице проекта) —
  // тот же эндпоинт .../funnel, потолок ids поднят там же с 10 до 200 под этот кейс.
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

  if (!isValidCategory) return <p className="text-sm text-muted-foreground">Неизвестная категория.</p>;
  const cat = category as Category;

  const displayName = (item: LeaderboardFullItem) => (cat === 'sources' ? SOURCE_LABEL[item.name] || item.name : item.name);

  return (
    <div className="space-y-4">
      <Link href={`/projects/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Назад к проекту
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">{CATEGORY_TITLE[cat]} — сравнение</h1>
        <PeriodSelector value={periodValue} onChange={setPeriodValue} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Всего: {data?.length ?? '—'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data?.length === 0 && <p className="text-sm text-muted-foreground">Нет данных за период.</p>}
          {data?.map((item, i) => {
            const itemFunnel = funnelById.get(item.id);
            return (
              <div key={item.id}>
                <div className="flex items-center justify-between text-sm gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                    {/* Клик по названию ведёт на страницу лендинга, отдельная иконка — превью
                        (запрос пользователя 2026-08-20, "точь-в-точь как в разделе ТОП"). */}
                    {cat === 'landings' ? (
                      <Link href={`/projects/${id}/landings/${item.id}`} className="truncate hover:underline">
                        {displayName(item)}
                      </Link>
                    ) : (
                      <span
                        className={`truncate ${item.isDeleted ? 'text-red-600 dark:text-red-400' : ''}`}
                        title={item.isDeleted ? 'Удалённый пользователь' : undefined}
                      >
                        {displayName(item)}
                      </span>
                    )}
                    {cat === 'landings' && (
                      <button
                        type="button"
                        onClick={() => previewLanding(item.id)}
                        className="shrink-0 text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400"
                        title="Предпросмотр лендинга"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-medium">${item.revenue.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.clients} {CLIENTS_COLUMN_LABEL[cat]}
                    </div>
                  </div>
                </div>
                {itemFunnel && <LeaderboardFunnelMini row={itemFunnel} />}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
