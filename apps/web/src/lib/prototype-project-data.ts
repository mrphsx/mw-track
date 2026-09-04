'use client';

import { useQuery, type Query } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';
import type { ClientRow } from '@/components/clients/clients-table';

// Общий слой данных для всех прототипов нового дизайна (Control Room/Studio/Ledger) —
// запросы к API идентичны для всех вариантов, различается только разметка. Вынесено сюда
// после ревью пользователя 2026-07-28 ("много не добавил из того, что есть на оригинальной
// странице") — раз объём данных на страницу проекта вырос до почти полного паритета с
// классической /projects/[id]/page.tsx, дублировать один и тот же fetch-код в 3 файлах уже
// не оправдано.

export interface PrototypeProjectSummary {
  id: string;
  name: string;
  status: string;
  channel: { id: string; type: string; isActive: boolean; tgAvatarFileId: string | null; websiteFaviconUrl?: string | null } | null;
  _count: { clients: number; pushes: number };
}

export interface PrototypeCompanyUsage {
  plan: string;
  planExpiresAt: string | null;
  maxProjects: number;
  currentProjects: number;
}

export function usePrototypeHomeData() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<PrototypeProjectSummary[]>('/projects')).data,
  });
  const { data: usage } = useQuery({
    queryKey: ['billing', 'current'],
    queryFn: async () => (await api.get<PrototypeCompanyUsage>('/billing/current')).data,
  });
  return { projects, isLoading, usage };
}

// Та же логика, что и в components/shared/subscription-banner.tsx (запрос пользователя
// 2026-07-20) — вынесена как чистая функция без разметки, чтобы каждый прототип мог отрисовать
// предупреждение в своём визуальном языке вместо переиспользования готового (светлого,
// hardcoded amber) компонента.
export function getSubscriptionWarning(usage?: PrototypeCompanyUsage): { daysLeft: number; expired: boolean; plan: string } | null {
  if (!usage?.planExpiresAt) return null;
  const daysLeft = Math.ceil((new Date(usage.planExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (usage.plan !== 'TRIAL' && daysLeft > 3) return null;
  return { daysLeft, expired: daysLeft < 0, plan: usage.plan };
}

export interface PrototypeProject {
  id: string;
  name: string;
  status: string;
  channel: {
    id: string;
    type: string;
    isActive: boolean;
    tgAvatarFileId: string | null;
    tgPersonalConnected: boolean;
    // Запрос пользователя 2026-08-05 — см. ProjectsService.sanitizeChannel для полного
    // комментария: true, если от Telegram давно не приходило вообще никаких вебхуков для
    // этого канала, хотя раньше они были (реальный ~20-часовой инцидент, обнаруженный только
    // постфактум по логам nginx).
    webhookStale?: boolean;
    // Обычный сайт (ChannelType.WEBSITE, запрос пользователя 2026-09-03) — причина, по которой
    // канал сейчас неактивен (WebsiteProvider.initialize пишет сюда описательный текст: "Укажите
    // ссылку на сайт" / "Скрипт не найден на странице..."), показывается пользователю как есть.
    lastError?: string | null;
    websiteUrl?: string | null;
    websiteFaviconUrl?: string | null;
  } | null;
  disabledTrackingEvents: string[];
}

// Полный набор — зеркалит ProjectStats классической /projects/[id]/page.tsx один в один
// (запрос пользователя 2026-07-28: "нет конверсий в топ метриках", "нет графиков" — не хватало
// botActivatedClients/totalCrmDialogues и всех daily-серий для графиков).
export interface PrototypeProjectStats {
  totalClients: number;
  activeClients: number;
  newClients: number;
  unsubscribedClients: number;
  botActivatedClients: number;
  conversionRate: number;
  totalRevenue: number;
  totalPageViews: number;
  totalLeads: number;
  totalFd: number;
  totalRd: number;
  totalDialogues: number;
  totalCrmDialogues: number;
  // Среднее время от подписки до первого диалога, в секундах (запрос пользователя 2026-07-30) —
  // null, если в периоде нет ни одного CRM-диалога с известной датой подписки.
  avgSubscribeToDialogueSeconds: number | null;
  dailySubscribers: { date: string; count: number }[];
  dailyPageViews: { date: string; count: number }[];
  dailyLeads: { date: string; count: number }[];
  dailyDialogues: { date: string; count: number; crmCount: number }[];
  dailyDeposits: { date: string; fdCount: number; rdCount: number; fdRevenue: number; rdRevenue: number }[];
  dailyRevenue: { date: string; amount: number }[];
}

export interface PrototypeFunnelStage {
  stage: string;
  count: number;
  label: string;
  rate?: number;
}

// Просмотры/клики приходят с бэка как два отдельных по-дневных массива — сливаем по дате для
// одного LineChart с двумя линиями (та же функция, что в классической странице проекта).
export function mergeDailySeries(a?: { date: string; count: number }[], b?: { date: string; count: number }[]) {
  const dates = new Set([...(a ?? []).map((d) => d.date), ...(b ?? []).map((d) => d.date)]);
  const aByDate = new Map((a ?? []).map((d) => [d.date, d.count]));
  const bByDate = new Map((b ?? []).map((d) => [d.date, d.count]));
  return Array.from(dates)
    .sort()
    .map((date) => ({ date, a: aByDate.get(date) ?? 0, b: bByDate.get(date) ?? 0 }));
}

export interface PrototypeAdRow {
  campaignId: string;
  campaignName: string | null;
  pageViews: number;
  leads: number;
  subscribes: number;
  dialogues: number;
  purchases: number;
  cr: number;
}

export interface PrototypeUnattributedBucket {
  clients: number;
  revenue: number;
}

export interface PrototypeLeaderboards {
  // isDeleted (запрос пользователя 2026-08-19: "показывает удалённых пользователей... лучше
  // показать имя красным + подсказка при наведении") — см. полный комментарий у classic-версии.
  buyers: { buyerId: string; name: string; isDeleted?: boolean; clients: number; revenue: number }[];
  pixels: { pixelId: string | null; label: string; clients: number; revenue: number }[];
  landings: { landingId: string; name: string; subscribers: number; revenue: number }[];
  campaigns: { campaignId: string; campaignName: string | null; clients: number; revenue: number }[];
  // Топ источников — Facebook/TikTok (запрос пользователя 2026-08-18) — см. полный комментарий у
  // classic-версии этого же интерфейса.
  sources: { source: 'FACEBOOK' | 'TIKTOK'; clients: number; revenue: number }[];
  // "Без баера/пикселя/кампании/источника" (запрос пользователя 2026-08-09) — см. полный
  // комментарий у classic-версии этого же интерфейса (apps/web/src/app/(dashboard)/projects/[id]/page.tsx).
  buyersUnattributed: PrototypeUnattributedBucket;
  pixelsUnattributed: PrototypeUnattributedBucket;
  campaignsUnattributed: PrototypeUnattributedBucket;
  sourcesUnattributed: PrototypeUnattributedBucket;
}

export type PrototypePeriod = 'today' | 'yesterday' | '7d' | '30d' | 'custom';

// Период — объект, а не голая строка (запрос пользователя 2026-07-28: "в версии studio нет
// возможности выбрать период кастомный") — 'custom' несёт ещё from/to, тот же принцип, что и
// PeriodValue в классической странице проекта (components/shared/period-selector.tsx).
export interface PrototypePeriodValue {
  period: PrototypePeriod;
  from?: string;
  to?: string;
}

export const PROTOTYPE_PERIOD_OPTIONS: { value: Exclude<PrototypePeriod, 'custom'>; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
];

export const PROTOTYPE_PERIOD_LABELS: Record<PrototypePeriod, string> = {
  today: 'за сегодня',
  yesterday: 'за вчера',
  '7d': 'за 7 дней',
  '30d': 'за 30 дней',
  custom: 'за период',
};

// Графики по дням имеют смысл только когда период реально покрывает несколько дней (запрос
// пользователя 2026-07-28: "графики показывать только если выбран период а не один день") —
// "Сегодня"/"Вчера" дают ровно одну точку на линии, что бессмысленно рисовать как тренд.
export function isSingleDayPeriod(periodValue: PrototypePeriodValue): boolean {
  return periodValue.period === 'today' || periodValue.period === 'yesterday';
}

// Баг-репорт пользователя 2026-08-05 (расхождение выручки/лидербордов на странице проекта —
// баер с $701/11 покупками, реально принадлежащими ДВУМ его проектам суммарно, показывался на
// странице ОДНОГО проекта, где у него на деле $129/1 покупка) — root cause: `keepPreviousData`
// применялся ко всем query ниже без разбора, ЧТО именно изменилось в queryKey. При смене
// периода (тот же проект) старые данные как временная заглушка — нормально и то, для чего это
// изначально просили. При смене САМОГО ПРОЕКТА (навигация между /projects/:id) — тоже применялся
// keepPreviousData, и старые (чужого проекта) деньги/имена баеров повисали на экране без какого-
// либо признака, что это не текущий проект, пока не подгрузится настоящий ответ. Для
// финансовых цифр это не косметическая, а вводящая в заблуждение утечка данных между проектами.
// Фикс: placeholder остаётся только если id предыдущего запроса совпадает с текущим — то есть
// только на смену периода, не проекта.
function samePlaceholderProject<T>(id: string) {
  return (previousData: T | undefined, previousQuery: Query<T> | undefined): T | undefined =>
    previousQuery?.queryKey[1] === id ? previousData : undefined;
}

export function usePrototypeProjectData(id: string, periodValue: PrototypePeriodValue) {
  const user = useAuthStore((s) => s.user);
  const canViewRevenue = hasPermission(user, id, 'STATS_VIEW_REVENUE');
  const canViewTeamLeaderboards = hasPermission(user, id, 'STATS_VIEW_TEAM_LEADERBOARDS');
  const canViewPersonalBroadcasts = hasPermission(user, id, 'PERSONAL_BROADCASTS_VIEW');

  // Кастомный период шлём на бэк только когда обе даты выбраны — иначе остаёмся на
  // предыдущих данных вместо запроса с половиной диапазона (тот же принцип, что в
  // классической странице проекта).
  const periodReady = periodValue.period !== 'custom' || (!!periodValue.from && !!periodValue.to);
  const periodParams =
    periodValue.period === 'custom' ? { period: periodValue.period, from: periodValue.from, to: periodValue.to } : { period: periodValue.period };

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => (await api.get<PrototypeProject>(`/projects/${id}`)).data,
  });

  // placeholderData: samePlaceholderProject(id) везде ниже (запрос пользователя 2026-07-28:
  // "дизайн... сильно прыгает при изменении вкладки или периода... пока блок подгружается его
  // нет") — старые данные остаются на экране до готовности новых, без пустого промежуточного
  // кадра, НО только при смене периода на этом же проекте (см. комментарий у функции выше) —
  // при переходе на другой проект показывается обычное состояние загрузки.
  const { data: stats } = useQuery({
    queryKey: ['project', id, 'stats', periodParams],
    queryFn: async () => (await api.get<PrototypeProjectStats>(`/projects/${id}/clients/stats`, { params: periodParams })).data,
    enabled: periodReady,
    placeholderData: samePlaceholderProject(id),
  });

  const { data: funnel } = useQuery({
    queryKey: ['project', id, 'funnel', periodParams],
    queryFn: async () => (await api.get<PrototypeFunnelStage[]>(`/projects/${id}/clients/funnel`, { params: periodParams })).data,
    enabled: periodReady,
    placeholderData: samePlaceholderProject(id),
  });

  // Полный ClientRow (та же форма, что у /projects/[id]/clients через ClientsTable) — запрос
  // пользователя 2026-07-28: "список клиентов не такой же, в нём мало информации" — раньше
  // тут был урезанный локальный тип на 5 полей вместо переиспользования настоящей таблицы.
  const { data: recentClients } = useQuery({
    queryKey: ['project', id, 'recent-clients', 10],
    queryFn: async () => (await api.get<{ items: ClientRow[] }>(`/projects/${id}/clients`, { params: { limit: 10 } })).data.items,
    placeholderData: samePlaceholderProject(id),
  });

  const { data: adBreakdown } = useQuery({
    queryKey: ['project', id, 'ad-breakdown', periodParams],
    queryFn: async () => (await api.get<PrototypeAdRow[]>(`/projects/${id}/ad-breakdown`, { params: periodParams })).data,
    enabled: periodReady,
    placeholderData: samePlaceholderProject(id),
  });

  const { data: leaderboards } = useQuery({
    queryKey: ['project', id, 'leaderboards', periodParams],
    queryFn: async () => (await api.get<PrototypeLeaderboards>(`/projects/${id}/leaderboards`, { params: periodParams })).data,
    enabled: periodReady,
    staleTime: Infinity,
    placeholderData: samePlaceholderProject(id),
  });

  return { project, stats, funnel, recentClients, adBreakdown, leaderboards, canViewRevenue, canViewTeamLeaderboards, canViewPersonalBroadcasts };
}

// GET /landings/:id/preview требует JWT — обычный <a href> не сработает, фетчим через
// авторизованный api-клиент и открываем как Blob URL (тот же приём, что в классической
// projects/[id]/page.tsx и landing-card.tsx).
export async function previewLanding(landingId: string): Promise<void> {
  const res = await api.get(`/landings/${landingId}/preview`, { responseType: 'text' });
  const blob = new Blob([res.data as string], { type: 'text/html' });
  window.open(URL.createObjectURL(blob), '_blank');
}
