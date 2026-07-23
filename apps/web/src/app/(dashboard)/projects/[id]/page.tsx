'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
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
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';

interface Project {
  id: string;
  name: string;
  status: string;
  channel: { id: string; type: string; isActive: boolean; tgAvatarFileId: string | null } | null;
}

interface ProjectStats {
  totalClients: number;
  activeClients: number;
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

interface ClientRow {
  id: string;
  tgFirstName: string | null;
  tgUsername: string | null;
  channelType: string | null;
  country: string | null;
  createdAt: string;
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
  adId: string | null;
  adName: string | null;
  pageViews: number;
  leads: number;
  subscribes: number;
  dialogues: number;
  purchases: number;
  cr: number;
}

interface Leaderboards {
  buyers: { buyerId: string; name: string; clients: number; revenue: number }[];
  pixels: { pixelId: string | null; label: string; conversions: number }[];
  landings: { landingId: string; name: string; subscribers: number; revenue: number }[];
  campaigns: { campaignId: string; campaignName: string | null; clients: number; revenue: number }[];
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

// Компактный лидерборд (запрос пользователя 2026-07-17: "топ баеров, топ пикселей, топ
// лэндингов, топ кампаний") — общий рендер для всех 4 карточек, различаются только заголовком
// и тем, что уже посчитано на бэке в GET /projects/:id/leaderboards. previewId — опционально,
// сейчас используется только в "Топ лэндингов".
function LeaderboardCard({
  title,
  items,
}: {
  title: string;
  items: { label: string; primary: string; secondary?: string; previewId?: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">Нет данных за период.</p>}
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-sm gap-2">
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
        ))}
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

export default function ProjectOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const canViewRevenue = hasPermission(user, 'STATS_VIEW_REVENUE');
  const canViewTeamLeaderboards = hasPermission(user, 'STATS_VIEW_TEAM_LEADERBOARDS');
  const [periodValue, setPeriodValue] = useState<PeriodValue>({ period: '30d' });
  const periodLabel = PERIOD_LABELS[periodValue.period];
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

  const { data: leaderboards } = useQuery({
    queryKey: ['project', id, 'leaderboards', periodParams],
    queryFn: async () => (await api.get<Leaderboards>(`/projects/${id}/leaderboards`, { params: periodParams })).data,
    enabled: periodReady,
  });

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
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            nativeButton={false}
            render={
              <Link href={`/projects/${id}/pushes/new`}>
                <Send className="w-4 h-4 mr-1.5" /> Рассылка
              </Link>
            }
          />
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
              <Link href={`/projects/${id}/automations`}>
                <Workflow className="w-4 h-4 mr-1.5" /> Автоворонки
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

      <PeriodSelector value={periodValue} onChange={setPeriodValue} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard label="Клиентов" value={stats?.totalClients ?? '—'} icon={Users} />
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
          ]}
        />
      </div>

      {/* Графики — вкладки вместо сетки карточек (запрос пользователя 2026-07-17: "лучше
          сделать как вкладки переключаемые"), тот же паттерн, что и лидерборды ниже. */}
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
                    <th className="py-1.5 pr-3 font-medium">Объявление</th>
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
                    <tr key={`${row.campaignId}::${row.adId ?? ''}`} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">{row.campaignName || row.campaignId}</td>
                      <td className="py-1.5 pr-3">{row.adName || row.adId || '—'}</td>
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
          топ"), тот же паттерн, что и графики выше. */}
      <Tabs defaultValue={canViewTeamLeaderboards ? 'buyers' : 'pixels'}>
        <TabsList>
          {canViewTeamLeaderboards && <TabsTrigger value="buyers">Топ баеров</TabsTrigger>}
          <TabsTrigger value="pixels">Топ пикселей</TabsTrigger>
          <TabsTrigger value="landings">Топ лэндингов</TabsTrigger>
          <TabsTrigger value="campaigns">Топ кампаний</TabsTrigger>
        </TabsList>

        <TabsContent value="buyers" className="mt-4">
          <LeaderboardCard
            title="Топ баеров"
            items={(leaderboards?.buyers ?? []).map((b) => ({
              label: b.name,
              primary: `$${b.revenue.toFixed(2)}`,
              secondary: `${b.clients} клиентов`,
            }))}
          />
        </TabsContent>
        <TabsContent value="pixels" className="mt-4">
          <LeaderboardCard
            title="Топ пикселей"
            items={(leaderboards?.pixels ?? []).map((p) => ({ label: p.label, primary: `${p.conversions} конверсий` }))}
          />
        </TabsContent>
        <TabsContent value="landings" className="mt-4">
          <LeaderboardCard
            title="Топ лэндингов"
            items={(leaderboards?.landings ?? []).map((l) => ({
              label: l.name,
              primary: `$${l.revenue.toFixed(2)}`,
              secondary: `${l.subscribers} подписчиков`,
              previewId: l.landingId,
            }))}
          />
        </TabsContent>
        <TabsContent value="campaigns" className="mt-4">
          <LeaderboardCard
            title="Топ кампаний"
            items={(leaderboards?.campaigns ?? []).map((c) => ({
              label: c.campaignName || c.campaignId,
              primary: `$${c.revenue.toFixed(2)}`,
              secondary: `${c.clients} клиентов`,
            }))}
          />
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Последние клиенты</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentClients?.length === 0 && <p className="text-sm text-muted-foreground">Пока нет клиентов.</p>}
          {recentClients?.map((client) => (
            <div key={client.id} className="flex items-center justify-between py-1.5 text-sm">
              <span>{client.tgFirstName || client.tgUsername || client.id}</span>
              <span className="text-muted-foreground">{client.country || '—'}</span>
            </div>
          ))}
          <Link href={`/projects/${id}/clients`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-block pt-1">
            Все клиенты →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
