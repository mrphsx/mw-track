'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  TrendingUp,
  DollarSign,
  Percent,
  Settings,
  Send,
  LayoutTemplate,
  Workflow,
  Eye,
  MousePointerClick,
  Wallet,
  Repeat,
  MessageCircle,
  ChevronRight,
  ChevronDown,
  LucideIcon,
  Bot,
  RefreshCw,
  Timer,
  Contact,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatsCard, DualStatsCard } from '@/components/shared/stats-card';
import { PeriodSelector, PeriodValue } from '@/components/shared/period-selector';
import { TRACKING_EVENT_TYPES } from '@/lib/tracking-events';
import { ClientsTable, ClientRow, formatSecondsDuration } from '@/components/clients/clients-table';
import { ClientDetailDrawer } from '@/components/clients/client-detail-drawer';
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';

interface Project {
  id: string;
  name: string;
  status: string;
  channel: {
    id: string;
    type: string;
    isActive: boolean;
    tgAvatarFileId: string | null;
    tgPersonalConnected: boolean;
    // Запрос пользователя 2026-08-05 — см. полный комментарий в apps/web/src/app/(dashboard)/projects/page.tsx.
    webhookStale?: boolean;
  } | null;
  disabledTrackingEvents: string[];
}

interface ProjectStats {
  // totalClients/activeClients — за ВСЁ ВРЕМЯ жизни проекта, намеренно не зависят от
  // PeriodSelector (держат синхронность с карточкой проекта в общем списке /projects, там
  // периода нет вообще) — карточка "Клиентов" ниже использует period-scoped newClients, не
  // это поле (баг-репорт пользователя 2026-07-24: "меняю периоды а количество остаётся тем же").
  totalClients: number;
  activeClients: number;
  // Клиенты, подписавшиеся именно в выбранном периоде (Client.subscribedAt в окне since/until)
  // — то, что реально должно стоять в карточке "Клиентов" на этой странице.
  newClients: number;
  // Отписавшиеся за тот же период (запрос пользователя 2026-07-24) — параллельная цифра,
  // newClients её не вычитает (кто-то мог подписаться и отписаться за один и тот же период —
  // и то и другое должно быть видно, а не взаимно погашаться).
  unsubscribedClients: number;
  // Активировавшие бота (запрос пользователя 2026-07-17) — firstDialogueAt задан, включая
  // тех, кто никогда не был подписан ни на один канал (в отличие от totalClients/activeClients,
  // которые считают только "наших" через subscribedAt).
  botActivatedClients: number;
  conversionRate: number;
  totalRevenue: number;
  // Просмотры/клики/ФД/РД за 30 дней (запрос пользователя 2026-07-17, "больше метрик на
  // странице проекта") — те же метрики, что уже есть в воронке конверсий, вынесены сюда как
  // самостоятельные карточки.
  totalPageViews: number;
  totalLeads: number;
  totalFd: number;
  totalRd: number;
  // Диалоги — важная метрика (запрос пользователя 2026-07-17), сумма за период вместо только
  // графика.
  totalDialogues: number;
  totalCrmDialogues: number;
  // Среднее время от подписки до первого диалога, в секундах (запрос пользователя 2026-07-30) —
  // null, если в периоде нет ни одного CRM-диалога с известной датой подписки.
  avgSubscribeToDialogueSeconds: number | null;
  dailySubscribers: { date: string; count: number }[];
  dailyPageViews: { date: string; count: number }[];
  dailyLeads: { date: string; count: number }[];
  // count — все новые диалоги (первое сообщение), crmCount — из них те, кто на момент
  // сообщения уже был подписан на канал через нашу воронку (запрос пользователя 2026-07-17).
  dailyDialogues: { date: string; count: number; crmCount: number }[];
  // fdCount/rdCount — первый/повторный депозит клиента (см. ClientsRepository.getProjectStats).
  dailyDeposits: { date: string; fdCount: number; rdCount: number; fdRevenue: number; rdRevenue: number }[];
  dailyRevenue: { date: string; amount: number }[];
}

interface FunnelStage {
  stage: string;
  count: number;
  label: string;
  rate?: number;
}


// Просмотры/клики приходят с бэка как два отдельных по-дневных массива (в отличие от
// dailyDialogues, где merge уже сделан на сервере) — сливаем по дате здесь же, для одного
// LineChart с двумя линиями. Даты не gap-filled, но это ок: обе серии считаются по одному и
// тому же `since`-окну, отсутствующая дата в одной серии просто означает 0 событий в тот день.
function mergeDailySeries(a?: { date: string; count: number }[], b?: { date: string; count: number }[]) {
  const dates = new Set([...(a ?? []).map((d) => d.date), ...(b ?? []).map((d) => d.date)]);
  const aByDate = new Map((a ?? []).map((d) => [d.date, d.count]));
  const bByDate = new Map((b ?? []).map((d) => [d.date, d.count]));
  return Array.from(dates)
    .sort()
    .map((date) => ({ date, a: aByDate.get(date) ?? 0, b: bByDate.get(date) ?? 0 }));
}

interface AdBreakdownRow {
  campaignId: string;
  campaignName: string | null;
  pageViews: number;
  leads: number;
  subscribes: number;
  dialogues: number;
  purchases: number;
  cr: number;
}

interface UnattributedBucket {
  clients: number;
  revenue: number;
}

interface Leaderboards {
  buyers: { buyerId: string; name: string; clients: number; revenue: number }[];
  // Багфикс 2026-07-28 ("пиксель с реальным подписчиком отсутствовал в топе") — раньше только
  // `conversions` (счётчик Purchase-событий, из-за чего пиксель без покупок пропадал из списка
  // целиком), теперь как у остальных категорий: clients (новых подписчиков за период) + revenue.
  pixels: { pixelId: string | null; label: string; clients: number; revenue: number }[];
  landings: { landingId: string; name: string; subscribers: number; revenue: number }[];
  campaigns: { campaignId: string; campaignName: string | null; clients: number; revenue: number }[];
  // "Без баера/пикселя/кампании" (запрос пользователя 2026-08-09: "104 клиента, а в топ баеров
  // только 27, где остальные?") — buyers/pixels/campaigns выше намеренно исключают клиентов без
  // атрибуции (ранжировать "неизвестно кого" бессмысленно), эти три поля — честный остаток,
  // чтобы сумма по категории видимо сходилась с общим числом клиентов за период.
  buyersUnattributed: UnattributedBucket;
  pixelsUnattributed: UnattributedBucket;
  campaignsUnattributed: UnattributedBucket;
}

// Предпросмотр лендинга (запрос пользователя 2026-07-17, "топ лэндингов... ссылка на превью
// для удобства") — тот же паттерн, что уже используют landing-card.tsx/apps/web/.../landings/
// page.tsx: GET /landings/:id/preview требует JWT, поэтому обычный <a href> не сработает
// (токен не уйдёт с навигацией) — фетчим через авторизованный api-клиент и открываем как
// Blob URL в новой вкладке. Работает для ЛЮБОГО лендинга, не только с привязанным доменом.
const previewLanding = async (landingId: string) => {
  const res = await api.get(`/landings/${landingId}/preview`, { responseType: 'text' });
  const blob = new Blob([res.data as string], { type: 'text/html' });
  window.open(URL.createObjectURL(blob), '_blank');
};

// Развёрнутая воронка на top-5 id одной категории лидерборда (запрос пользователя 2026-07-27:
// "показывай и просмотры, диалоги, выручка, клики и конверсии из каждой в следующую") — GET
// /projects/:id/leaderboards/:category/funnel, лениво подгружается только для реально открытой
// вкладки (см. activeLeaderboardTab ниже), не на каждой загрузке страницы. pageViews/leads
// отсутствуют у баеров (см. бэкенд-комментарий у ProjectsService.getBuyersFunnel) — атрибуция
// баера резолвится только на подписке, просмотры/клики баеру принципиально не приписать.
interface LeaderboardFunnelRow {
  id: string;
  pageViews?: number;
  leads?: number;
  subscribes: number;
  dialogues: number;
  purchases: number;
  revenue: number;
}

type LeaderboardCategory = 'buyers' | 'pixels' | 'landings' | 'campaigns';

// Компактная строка-воронка под каждым элементом лидерборда — сознательно НЕ полноразмерный
// ConversionFunnel (5 карточек × 4 категории на странице было бы избыточно тяжело визуально),
// просто иконка+число+% от предыдущего шага в один ряд, с переносом на мобильном. Тот же
// цветовой язык (FUNNEL_STAGE_STYLE), что и у основной воронки проекта выше на этой же странице.
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
            <span
              className="inline-flex items-center gap-0.5 shrink-0"
              title={rate !== undefined ? `${rate}% от предыдущего шага` : undefined}
            >
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

// Компактный лидерборд (запрос пользователя 2026-07-17: "топ баеров, топ пикселей, топ
// лэндингов, топ кампаний") — общий рендер для всех 4 карточек, различаются только заголовком
// и тем, что уже посчитано на бэке в GET /projects/:id/leaderboards. previewId — опционально,
// сейчас используется только в "Топ лэндингов". funnelById/funnelLoading — опционально,
// передаются только для реально открытой вкладки (запрос пользователя 2026-07-27).
function LeaderboardCard({
  title,
  items,
  funnelById,
  funnelLoading,
  unattributed,
  unattributedLabel,
}: {
  title: string;
  items: { id: string; label: string; primary: string; secondary?: string; previewId?: string }[];
  funnelById?: Map<string, LeaderboardFunnelRow>;
  funnelLoading?: boolean;
  // "Без баера/пикселя/кампании" (запрос пользователя 2026-08-09: "104 клиента, а в топ баеров
  // только 27, где остальные?") — отдельная, не ранжируемая строка внизу списка: клиенты без
  // атрибуции реально существуют (видны в общей статистике проекта), просто не участвуют в топе
  // конкретных баеров/пикселей/кампаний. Показываем только когда clients > 0 — на большинстве
  // проектов атрибуция полная, лишняя строка с нулём была бы просто шумом.
  unattributed?: UnattributedBucket;
  unattributedLabel?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 && !unattributed?.clients && <p className="text-sm text-muted-foreground">Нет данных за период.</p>}
        {items.map((item, i) => {
          const funnel = funnelById?.get(item.id);
          return (
            <div key={item.id}>
              <div className="flex items-center justify-between text-sm gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                  <span className="truncate">{item.label}</span>
                  {item.previewId && (
                    <button
                      type="button"
                      onClick={() => previewLanding(item.previewId!)}
                      className="shrink-0 text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400"
                      title="Предпросмотр лендинга"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-medium">{item.primary}</div>
                  {item.secondary && <div className="text-xs text-muted-foreground">{item.secondary}</div>}
                </div>
              </div>
              {funnel && <LeaderboardFunnelMini row={funnel} />}
              {funnelLoading && !funnel && <p className="text-xs text-muted-foreground mt-1.5 pt-1.5 border-t">Загрузка воронки...</p>}
            </div>
          );
        })}
        {!!unattributed?.clients && (
          <div className="flex items-center justify-between text-sm gap-2 pt-2 border-t border-dashed">
            <span className="text-muted-foreground italic truncate">{unattributedLabel}</span>
            <div className="text-right shrink-0">
              <div className="font-medium text-muted-foreground">{unattributed.clients} клиентов</div>
              {unattributed.revenue > 0 && <div className="text-xs text-muted-foreground">${unattributed.revenue.toFixed(2)}</div>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Цвет+иконка на стадию воронки (запрос пользователя 2026-07-17: "покажи красиво, цвета и
// стрелки итд") — те же цвета, что уже используются на графиках выше (Eye/просмотры —
// фиолетовый, клики — cyan, диалоги — зелёный, ФД/РД — amber/teal), чтобы визуальный язык был
// единым по всей странице, а не придуман заново для воронки.
const FUNNEL_STAGE_STYLE: Record<string, { icon: LucideIcon; color: string }> = {
  PageView: { icon: Eye, color: '#7c3aed' },
  Lead: { icon: MousePointerClick, color: '#0891b2' },
  Subscribe: { icon: Users, color: '#2563eb' },
  Dialogue: { icon: MessageCircle, color: '#16a34a' },
  FirstDeposit: { icon: Wallet, color: '#d97706' },
  RepeatDeposit: { icon: Repeat, color: '#0d9488' },
};

// Горизонтальная воронка с цветными шагами и стрелками-коннекторами вместо простого списка
// (запрос пользователя 2026-07-17). Ширина фонового "заполнения" внутри каждого шага
// пропорциональна count/count(первого шага) — наглядно показывает просадку, но сама карточка
// остаётся той же ширины (flex-1), поэтому на телефоне блоки просто стекают в колонку
// (flex-col -> md:flex-row), ничего не переполняется и не ломается. Стрелка тоже меняет
// направление: → на десктопе, ↓ на мобильном (два разных lucide-иконки, переключаются через
// hidden/md:block, а не JS-медиазапрос).
function ConversionFunnel({ stages }: { stages?: FunnelStage[] }) {
  if (!stages?.length) return <p className="text-sm text-muted-foreground">Нет данных за период.</p>;
  const maxCount = stages[0].count || 0;
  const last = stages[stages.length - 1];
  const overallRate = maxCount > 0 ? Math.round((last.count / maxCount) * 100 * 10) / 10 : 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Итоговая конверсия:{' '}
        <span className="font-semibold text-foreground">
          {overallRate}% ({stages[0].label} → {last.label})
        </span>
      </p>
      <div className="flex flex-col md:flex-row md:items-stretch gap-1.5">
        {stages.map((stage, i) => {
          const style = FUNNEL_STAGE_STYLE[stage.stage] ?? { icon: TrendingUp, color: '#6b7280' };
          const Icon = style.icon;
          const fillPct = maxCount > 0 ? Math.round((stage.count / maxCount) * 100) : 0;

          return (
            <Fragment key={stage.stage}>
              {i > 0 && (
                <div className="flex items-center justify-center text-muted-foreground shrink-0">
                  <ChevronDown className="w-5 h-5 md:hidden" />
                  <ChevronRight className="w-5 h-5 hidden md:block" />
                </div>
              )}
              <div className="relative flex-1 min-w-0 rounded-lg border border overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 transition-all"
                  style={{ background: style.color, opacity: 0.08, width: `${fillPct}%` }}
                />
                <div className="relative p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: style.color }} />
                    <span className="truncate">{stage.label}</span>
                  </div>
                  <div className="text-xl font-bold mt-1">{stage.count}</div>
                  {stage.rate !== undefined && (
                    <div className="text-xs mt-0.5 font-medium" style={{ color: style.color }}>
                      {stage.rate}% от предыдущего
                    </div>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

const PERIOD_LABELS: Record<PeriodValue['period'], string> = {
  today: 'за сегодня',
  yesterday: 'за вчера',
  '7d': 'за 7 дней',
  '30d': 'за 30 дней',
  custom: 'за период',
};

const PERIOD_VALUES = ['today', 'yesterday', '7d', '30d', 'custom'] as const;

// Читает период из query-параметров ссылки (?period=...&from=...&to=...) — запрос пользователя
// 2026-07-25: "при обновлении страницы должен остаться выбранный период" (раньше был просто
// useState, сбрасывался на дефолт при каждой перезагрузке). По умолчанию — "Сегодня" (тот же
// запрос: "изначально ставь период СЕГОДНЯ"), не "30 дней", как было.
function readPeriodFromSearchParams(params: URLSearchParams): PeriodValue {
  const period = params.get('period');
  if (period === 'custom') {
    const from = params.get('from') || undefined;
    const to = params.get('to') || undefined;
    if (from && to) return { period: 'custom', from, to };
  }
  if (period && (PERIOD_VALUES as readonly string[]).includes(period)) return { period: period as PeriodValue['period'] };
  return { period: 'today' };
}

export default function ProjectOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const canViewRevenue = hasPermission(user, id, 'STATS_VIEW_REVENUE');
  const canViewTeamLeaderboards = hasPermission(user, id, 'STATS_VIEW_TEAM_LEADERBOARDS');
  const [periodValue, setPeriodValueState] = useState<PeriodValue>(() => readPeriodFromSearchParams(searchParams));
  // Запрос пользователя 2026-07-27: "показывай сразу как список на странице клиентов, со всеми
  // параметрами, только без фильтров" — переиспользуем ClientsTable/ClientDetailDrawer 1:1,
  // тот же компонент, что и на /projects/[id]/clients, а не свой урезанный рендер.
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const setPeriodValue = (next: PeriodValue) => {
    setPeriodValueState(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('period', next.period);
    if (next.period === 'custom') {
      if (next.from) params.set('from', next.from); else params.delete('from');
      if (next.to) params.set('to', next.to); else params.delete('to');
    } else {
      params.delete('from');
      params.delete('to');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const periodLabel = PERIOD_LABELS[periodValue.period];
  // Графики по дням не показываем для однодневного периода (запрос пользователя 2026-07-29) —
  // см. комментарий у Tabs ниже.
  const isSingleDayPeriod = periodValue.period === 'today' || periodValue.period === 'yesterday';
  // Кастомный период шлём на бэк только когда обе даты выбраны — иначе остаёмся на
  // предыдущих данных вместо запроса с половиной диапазона.
  const periodReady = periodValue.period !== 'custom' || (!!periodValue.from && !!periodValue.to);
  const periodParams =
    periodValue.period === 'custom' ? { period: periodValue.period, from: periodValue.from, to: periodValue.to } : { period: periodValue.period };

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => (await api.get<Project>(`/projects/${id}`)).data,
  });

  const { data: stats } = useQuery({
    queryKey: ['project', id, 'stats', periodParams],
    queryFn: async () => (await api.get<ProjectStats>(`/projects/${id}/clients/stats`, { params: periodParams })).data,
    enabled: periodReady,
  });

  const { data: funnel } = useQuery({
    queryKey: ['project', id, 'funnel', periodParams],
    queryFn: async () => (await api.get<FunnelStage[]>(`/projects/${id}/clients/funnel`, { params: periodParams })).data,
    enabled: periodReady,
  });

  const { data: recentClients } = useQuery({
    queryKey: ['project', id, 'recent-clients'],
    queryFn: async () => (await api.get<{ items: ClientRow[] }>(`/projects/${id}/clients`, { params: { limit: 5 } })).data.items,
  });

  const { data: adBreakdown } = useQuery({
    queryKey: ['project', id, 'ad-breakdown', periodParams],
    queryFn: async () => (await api.get<AdBreakdownRow[]>(`/projects/${id}/ad-breakdown`, { params: periodParams })).data,
    enabled: periodReady,
  });

  // staleTime: Infinity (запрос пользователя 2026-07-28: "не подгружай каждый раз заново, а
  // сохраняй для экономии ресурсов сервера, добавь кнопку обновления") — раз загруженные
  // лидерборды/воронка больше не перезапрашиваются сами по себе (ни при возврате на вкладку, ни
  // при повторном фокусе окна — тот и так глобально off, см. providers.tsx), только явным
  // нажатием кнопки "Обновить" (refreshLeaderboards ниже) или сменой периода/вкладки — то и
  // другое законно новые данные, а не просто "тот же запрос ещё раз".
  const { data: leaderboards, isFetching: leaderboardsLoading } = useQuery({
    queryKey: ['project', id, 'leaderboards', periodParams],
    queryFn: async () => (await api.get<Leaderboards>(`/projects/${id}/leaderboards`, { params: periodParams })).data,
    enabled: periodReady,
    staleTime: Infinity,
  });

  // Развёрнутая воронка по вкладке (запрос пользователя 2026-07-27) — намеренно НЕ часть
  // основного leaderboards-запроса выше: считается только для той категории, вкладку которой
  // пользователь реально открыл (activeLeaderboardTab), id уже известны из уже загруженного
  // leaderboards, второго похода "какие top-5" не нужно. Так обычный визит страницы проекта
  // (лидерборды почти всегда закрыты) вообще не платит за эти доп. запросы к БД.
  const [activeLeaderboardTab, setActiveLeaderboardTab] = useState<LeaderboardCategory>(canViewTeamLeaderboards ? 'buyers' : 'pixels');

  // "Только свои клиенты" (запрос пользователя 2026-08-03) — вкладку "buyers" не знаем заранее
  // (нужен ответ бэкенда), поэтому если пользователь по умолчанию открылся на ней, а лидерборды
  // загрузились пустыми (скоуп-баер), переключаемся на первую реально видимую вкладку.
  useEffect(() => {
    if (activeLeaderboardTab === 'buyers' && leaderboards && leaderboards.buyers.length === 0) {
      setActiveLeaderboardTab('pixels');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaderboards]);

  const activeLeaderboardIds: string[] = !leaderboards
    ? []
    : activeLeaderboardTab === 'buyers'
      ? leaderboards.buyers.map((b) => b.buyerId).filter(Boolean)
      : activeLeaderboardTab === 'pixels'
        ? leaderboards.pixels.map((p) => p.pixelId).filter((v): v is string => !!v)
        : activeLeaderboardTab === 'landings'
          ? leaderboards.landings.map((l) => l.landingId)
          : leaderboards.campaigns.map((c) => c.campaignId).filter(Boolean);

  const { data: leaderboardFunnel, isFetching: leaderboardFunnelLoading } = useQuery({
    queryKey: ['project', id, 'leaderboard-funnel', activeLeaderboardTab, periodParams, activeLeaderboardIds.join(',')],
    queryFn: async () =>
      (
        await api.get<{ items: LeaderboardFunnelRow[] }>(`/projects/${id}/leaderboards/${activeLeaderboardTab}/funnel`, {
          params: { ...periodParams, ids: activeLeaderboardIds.join(',') },
        })
      ).data.items,
    enabled: periodReady && activeLeaderboardIds.length > 0,
    staleTime: Infinity,
  });
  const leaderboardFunnelById = new Map((leaderboardFunnel ?? []).map((r) => [r.id, r]));

  const refreshingLeaderboards = leaderboardsLoading || leaderboardFunnelLoading;
  const refreshLeaderboards = () => {
    queryClient.invalidateQueries({ queryKey: ['project', id, 'leaderboards'] });
    queryClient.invalidateQueries({ queryKey: ['project', id, 'leaderboard-funnel'] });
  };

  if (!project) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          {/* Название/иконка проекта переехали в общий заголовок (projects/[id]/layout.tsx,
              запрос пользователя 2026-07-18) — здесь остаётся только статус канала, он про
              состояние ЭТОЙ страницы, а не про идентичность проекта. */}
          {project.channel && (
            <div className="flex gap-1.5">
              <Badge variant={project.channel.isActive ? 'outline' : 'destructive'} className="text-xs">
                {project.channel.type}
              </Badge>
              {/* "Молчащий" вебхук (запрос пользователя 2026-08-05, после реального ~20-часового
                  инцидента — Telegram молча перестал слать вебхуки боту, узнали постфактум по
                  логам nginx) — отдельно от isActive: бот технически жив, просто Telegram не
                  присылает апдейты. */}
              {project.channel.webhookStale && (
                <Badge variant="destructive" className="text-xs" title="Telegram давно не присылал вебхуки этому боту — возможно, трафик не регистрируется">
                  Нет вебхуков
                </Badge>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {/* Баг-репорт пользователя 2026-07-28: "не могу попасть на страницу история рассылок"
              — кнопка вела прямиком на форму создания (pushes/new), минуя список/историю
              рассылок (pushes) целиком, в отличие от соседних кнопок "Лендинги"/"Сценарии" (обе
              ведут на список, создание — отдельной кнопкой уже на самой странице списка). Список
              рассылок уже существовал и работал, просто до него не было пути из интерфейса. */}
          <Button
            nativeButton={false}
            render={
              <Link href={`/projects/${id}/pushes`}>
                <Send className="w-4 h-4 mr-1.5" /> Рассылка
              </Link>
            }
          />
          {/* Рассылка с личного MTProto-аккаунта (запрос пользователя 2026-08-06) — отдельная от
              обычной "Рассылка" (та идёт через бота), нет company-wide/мульти-проектного смысла
              как у Push (у каждого проекта свой личный аккаунт-персона), поэтому это кнопка на
              странице проекта, а не пункт сайдбара. Видна только когда личный аккаунт подключён
              и есть право на просмотр раздела. */}
          {project.channel?.tgPersonalConnected && hasPermission(user, id, 'PERSONAL_BROADCASTS_VIEW') && (
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link href={`/projects/${id}/personal-broadcasts`}>
                  <Contact className="w-4 h-4 mr-1.5" /> Личный аккаунт
                </Link>
              }
            />
          )}
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link href={`/projects/${id}/landings`}>
                <LayoutTemplate className="w-4 h-4 mr-1.5" /> Лендинги
              </Link>
            }
          />
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link href={`/projects/${id}/scenarios`}>
                <Workflow className="w-4 h-4 mr-1.5" /> Сценарии
              </Link>
            }
          />
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link href={`/projects/${id}/settings`}>
                <Settings className="w-4 h-4 mr-1.5" /> Настройки
              </Link>
            }
          />
        </div>
      </div>

      {/* Индикатор вкл/выкл пересылки событий в Facebook/TikTok по типу (запрос пользователя
          2026-07-27) — сами свитчи находятся в /settings, вкладка "События", здесь только
          сводка, чтобы было видно с первого взгляда, что сейчас выключено. */}
      <div className="flex flex-wrap gap-1.5">
        {TRACKING_EVENT_TYPES.map((eventType) => {
          const isEnabled = !project.disabledTrackingEvents.includes(eventType.name);
          return (
            <Badge
              key={eventType.name}
              variant="outline"
              className={`text-xs gap-1.5 ${isEnabled ? 'text-muted-foreground' : 'text-red-500 border-red-200 dark:border-red-900'}`}
              title={eventType.description}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isEnabled ? 'bg-emerald-500' : 'bg-red-500'}`} />
              {eventType.label}
            </Badge>
          );
        })}
      </div>

      <PeriodSelector value={periodValue} onChange={setPeriodValue} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          label="Клиентов"
          value={stats?.newClients ?? '—'}
          icon={Users}
          dangerHint={stats && stats.unsubscribedClients > 0 ? `−${stats.unsubscribedClients} отписались` : undefined}
        />
        {/* "Активных" убрана по запросу пользователя 2026-07-18 — дублировала смысл
            "Активировали бота" (обе про то, кому можно слать пуши), оставили одну. */}
        <StatsCard label="Активировали бота" value={stats?.botActivatedClients ?? '—'} icon={Bot} />
        {canViewRevenue && <StatsCard label="Доход" value={stats ? `$${stats.totalRevenue.toFixed(2)}` : '—'} icon={DollarSign} />}
        <StatsCard label="Конверсия" value={stats ? `${stats.conversionRate}%` : '—'} icon={Percent} />
        <DualStatsCard
          items={[
            { label: 'ФД', value: stats?.totalFd ?? '—', icon: Wallet },
            { label: 'РД', value: stats?.totalRd ?? '—', icon: Repeat },
          ]}
        />
      </div>

      {/* Просмотры/клики/диалоги за период — та же цепочка воронки, что и ниже, отдельными
          карточками (запрос пользователя 2026-07-17: "диалоги очень важная метрика"). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatsCard label="Просмотры" value={stats?.totalPageViews ?? '—'} icon={Eye} />
        <StatsCard label="Клики" value={stats?.totalLeads ?? '—'} icon={MousePointerClick} />
        <DualStatsCard
          items={[
            { label: 'Диалоги', value: stats?.totalDialogues ?? '—', icon: MessageCircle },
            { label: 'Из CRM', value: stats?.totalCrmDialogues ?? '—', icon: MessageCircle },
            // Среднее время от подписки до диалога (запрос пользователя 2026-07-30) — та же
            // карточка, третьим пунктом, а не отдельная StatsCard: логически это уточнение
            // именно диалоговых метрик рядом, а не самостоятельная величина.
            {
              label: 'Ср. время до диалога',
              value: stats ? (stats.avgSubscribeToDialogueSeconds !== null ? formatSecondsDuration(stats.avgSubscribeToDialogueSeconds) : '—') : '—',
              icon: Timer,
            },
          ]}
        />
      </div>

      {/* Графики по дням имеют смысл только для периода от нескольких дней (запрос пользователя
          2026-07-28/29: "графики показывать только если выбран период а не один день") —
          "Сегодня"/"Вчера" дают одну точку на линии. Воронка — не дневной график (снимок за
          период), остаётся видна всегда, поэтому при однодневном периоде показываем её одну,
          без остальных вкладок графиков. */}
      {isSingleDayPeriod ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground rounded-lg border border-border bg-card p-4">
            Графики по дням доступны для периода от 7 дней — на «Сегодня»/«Вчера» это была бы одна точка.
          </p>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Воронка конверсий {periodLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <ConversionFunnel stages={funnel} />
            </CardContent>
          </Card>
        </div>
      ) : (
      <Tabs defaultValue="subscribers">
        <TabsList>
          <TabsTrigger value="subscribers">Подписчики</TabsTrigger>
          <TabsTrigger value="views-clicks">Просмотры и клики</TabsTrigger>
          <TabsTrigger value="dialogues">Диалоги</TabsTrigger>
          <TabsTrigger value="deposits">Депозиты (ФД/РД)</TabsTrigger>
          <TabsTrigger value="revenue">Выручка</TabsTrigger>
          <TabsTrigger value="funnel">Воронка конверсий</TabsTrigger>
        </TabsList>

        <TabsContent value="subscribers" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Подписчики {periodLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={stats?.dailySubscribers ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')} />
                  <Line type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="views-clicks" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Просмотры и клики {periodLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-xs text-muted-foreground mb-1">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#7c3aed' }} /> Просмотры
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#0891b2' }} /> Клики
                </span>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={mergeDailySeries(stats?.dailyPageViews, stats?.dailyLeads)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')} />
                  <Line type="monotone" dataKey="a" name="Просмотры" stroke="#7c3aed" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="b" name="Клики" stroke="#0891b2" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dialogues" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Диалоги {periodLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-xs text-muted-foreground mb-1">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#16a34a' }} /> Все диалоги
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#2563eb' }} /> Из нашей CRM
                </span>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={stats?.dailyDialogues ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')} />
                  <Line type="monotone" dataKey="count" name="Все диалоги" stroke="#16a34a" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="crmCount" name="Из нашей CRM" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deposits" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Депозиты (ФД/РД) {periodLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-xs text-muted-foreground mb-1">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#d97706' }} /> ФД
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#0d9488' }} /> РД
                </span>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={stats?.dailyDeposits ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')} />
                  <Line type="monotone" dataKey="fdCount" name="ФД" stroke="#d97706" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="rdCount" name="РД" stroke="#0d9488" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="revenue" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Выручка по дням</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={stats?.dailyRevenue ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')}
                    formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Выручка']}
                  />
                  <Line type="monotone" dataKey="amount" stroke="#d97706" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funnel" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Воронка конверсий {periodLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <ConversionFunnel stages={funnel} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      )}

      {!!adBreakdown?.length && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Разбивка по рекламе</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Данные приходят из ad_id/campaign_id, захваченных из макросов Facebook/TikTok
                на трекинг-ссылке лендинга (запрос пользователя 2026-07-04, "получить ссылку") —
                строка появляется только если по этой кампании/объявлению был хотя бы один клик. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-1.5 pr-3 font-medium">Кампания</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Просмотры</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Клики</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Подписки</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Диалоги</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Покупки</th>
                    <th className="py-1.5 font-medium text-right">CR</th>
                  </tr>
                </thead>
                <tbody>
                  {adBreakdown.map((row) => (
                    <tr key={row.campaignId} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">{row.campaignName || row.campaignId}</td>
                      <td className="py-1.5 pr-3 text-right">{row.pageViews}</td>
                      <td className="py-1.5 pr-3 text-right">{row.leads}</td>
                      <td className="py-1.5 pr-3 text-right">{row.subscribes}</td>
                      <td className="py-1.5 pr-3 text-right">{row.dialogues}</td>
                      <td className="py-1.5 pr-3 text-right">{row.purchases}</td>
                      <td className="py-1.5 text-right">{row.cr}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Лидерборды — тоже вкладки (запрос пользователя 2026-07-17: "так же как и метрики
          топ"), тот же паттерн, что и графики выше. Развёрнутая воронка (запрос пользователя
          2026-07-27) подгружается только для реально открытой вкладки — activeLeaderboardTab. */}
      <Tabs value={activeLeaderboardTab} onValueChange={(v) => v && setActiveLeaderboardTab(v as LeaderboardCategory)}>
        <div className="flex items-center justify-between gap-2">
          <TabsList>
            {/* "Только свои клиенты" (запрос пользователя 2026-08-03) — бэкенд возвращает
                пустой buyers[] для скоуп-баера (ProjectsController.getLeaderboards), ранжировать
                одного человека против самого себя бессмысленно — прячем вкладку целиком вместо
                показа пустого списка. */}
            {canViewTeamLeaderboards && (leaderboards?.buyers?.length ?? 0) > 0 && <TabsTrigger value="buyers">Топ баеров</TabsTrigger>}
            <TabsTrigger value="pixels">Топ пикселей</TabsTrigger>
            <TabsTrigger value="landings">Топ лэндингов</TabsTrigger>
            <TabsTrigger value="campaigns">Топ кампаний</TabsTrigger>
          </TabsList>
          {/* Запрос пользователя 2026-07-28: данные лидербордов/воронки больше не обновляются
              сами по себе (staleTime: Infinity выше) — только по этой кнопке, чтобы не грузить
              БД лишними запросами на каждое открытие вкладки/возврат на страницу. */}
          <Button variant="ghost" size="sm" onClick={refreshLeaderboards} disabled={refreshingLeaderboards} className="shrink-0">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshingLeaderboards ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>

        <TabsContent value="buyers" className="mt-4">
          <LeaderboardCard
            title="Топ баеров"
            items={(leaderboards?.buyers ?? []).map((b) => ({
              id: b.buyerId,
              label: b.name,
              primary: `$${b.revenue.toFixed(2)}`,
              secondary: `${b.clients} клиентов`,
            }))}
            funnelById={activeLeaderboardTab === 'buyers' ? leaderboardFunnelById : undefined}
            funnelLoading={activeLeaderboardTab === 'buyers' && leaderboardFunnelLoading}
            unattributed={leaderboards?.buyersUnattributed}
            unattributedLabel="Без баера"
          />
        </TabsContent>
        <TabsContent value="pixels" className="mt-4">
          <LeaderboardCard
            title="Топ пикселей"
            items={(leaderboards?.pixels ?? []).map((p) => ({
              id: p.pixelId || 'none',
              label: p.label,
              primary: `$${p.revenue.toFixed(2)}`,
              secondary: `${p.clients} клиентов`,
            }))}
            funnelById={activeLeaderboardTab === 'pixels' ? leaderboardFunnelById : undefined}
            funnelLoading={activeLeaderboardTab === 'pixels' && leaderboardFunnelLoading}
            unattributed={leaderboards?.pixelsUnattributed}
            unattributedLabel="Без пикселя"
          />
        </TabsContent>
        <TabsContent value="landings" className="mt-4">
          <LeaderboardCard
            title="Топ лэндингов"
            items={(leaderboards?.landings ?? []).map((l) => ({
              id: l.landingId,
              label: l.name,
              primary: `$${l.revenue.toFixed(2)}`,
              secondary: `${l.subscribers} подписчиков`,
              previewId: l.landingId,
            }))}
            funnelById={activeLeaderboardTab === 'landings' ? leaderboardFunnelById : undefined}
            funnelLoading={activeLeaderboardTab === 'landings' && leaderboardFunnelLoading}
          />
        </TabsContent>
        <TabsContent value="campaigns" className="mt-4">
          <LeaderboardCard
            title="Топ кампаний"
            items={(leaderboards?.campaigns ?? []).map((c) => ({
              id: c.campaignId,
              label: c.campaignName || c.campaignId,
              primary: `$${c.revenue.toFixed(2)}`,
              secondary: `${c.clients} клиентов`,
            }))}
            funnelById={activeLeaderboardTab === 'campaigns' ? leaderboardFunnelById : undefined}
            funnelLoading={activeLeaderboardTab === 'campaigns' && leaderboardFunnelLoading}
            unattributed={leaderboards?.campaignsUnattributed}
            unattributedLabel="Без кампании"
          />
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Последние клиенты</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentClients?.length === 0 && <p className="text-sm text-muted-foreground">Пока нет клиентов.</p>}
          {recentClients && recentClients.length > 0 && (
            <ClientsTable projectId={id} clients={recentClients} onSelect={setSelectedClientId} />
          )}
          <Link href={`/projects/${id}/clients`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-block pt-1">
            Все клиенты →
          </Link>
        </CardContent>
      </Card>

      <ClientDetailDrawer projectId={id} clientId={selectedClientId} onClose={() => setSelectedClientId(null)} />
    </div>
  );
}
