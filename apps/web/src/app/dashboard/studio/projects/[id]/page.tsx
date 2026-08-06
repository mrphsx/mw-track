'use client';

import { Fragment, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Contact,
  DollarSign,
  Eye,
  LayoutTemplate,
  LucideIcon,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  Percent,
  Repeat,
  RefreshCw,
  Send,
  Settings,
  Target,
  Timer,
  TrendingUp,
  Users,
  Wallet,
  Workflow,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ChannelAvatar } from '@/components/channel-avatar';
import { ClientDetailDrawer } from '@/components/clients/client-detail-drawer';
import { formatSecondsDuration } from '@/components/clients/clients-table';
import { DailyCharts } from '@/components/prototype/daily-charts';
import { Input } from '@/components/ui/input';
import { TRACKING_EVENT_TYPES } from '@/lib/tracking-events';
import {
  PROTOTYPE_PERIOD_LABELS,
  PROTOTYPE_PERIOD_OPTIONS,
  PrototypeFunnelStage,
  PrototypePeriodValue,
  isSingleDayPeriod,
  previewLanding,
  usePrototypeProjectData,
} from '@/lib/prototype-project-data';
import { STUDIO_HUE_HEX, STUDIO_HUES, StudioHueName } from '../../colors';
import { StudioPill } from '../../ui';
import { StudioClientsTable } from '../../clients-table';

const FUNNEL_ICON: Record<string, LucideIcon> = {
  PageView: Eye,
  Lead: MousePointerClick,
  Subscribe: Users,
  Dialogue: MessageCircle,
  FirstDeposit: Wallet,
  RepeatDeposit: Repeat,
};

// Каждому шагу воронки — свой оттенок (запрос пользователя 2026-07-28: "не хватает цветов
// немного других, всё сильно однообразное") — раньше все шаги красились в один и тот же
// янтарь, разница была только в яркости заливки.
const FUNNEL_HUE: Record<string, StudioHueName> = {
  PageView: 'slate',
  Lead: 'teal',
  Subscribe: 'amber',
  Dialogue: 'plum',
  FirstDeposit: 'sage',
  RepeatDeposit: 'sage',
};

type LeaderboardCategory = 'buyers' | 'pixels' | 'landings' | 'campaigns';

// Развёрнутая воронка под элементом топа — /projects/:id/leaderboards/:category/funnel,
// зеркалит классическую страницу проекта (см. LeaderboardFunnelRow там же). pageViews/leads
// отсутствуют у баеров (атрибуция баера резолвится только на подписке).
interface LeaderboardFunnelRow {
  id: string;
  pageViews?: number;
  leads?: number;
  subscribes: number;
  dialogues: number;
  purchases: number;
  revenue: number;
}

// Прототип "Studio" для страницы проекта — пользователь решил дорабатывать именно этот
// вариант дальше (2026-07-28: "давай остановимся пока на studio"), Control Room/Ledger
// заморожены. Правки этого раунда:
// 1) метрики — не сетка из 8 одинаковых плиток разом, а "featured" карточка + ряд пилюль-
//    переключателей (запрос: "открывать отдельно, для большего места для статистики");
// 2) график/список клиентов/иконки получили СВОЙ вид вместо переиспользования общих
//    компонентов один-в-один (запрос: "график, список клиентов, иконки... остался тем же");
// 3) палитра расширена с одного янтаря на 5 оттенков — см. ../colors.ts;
// 4) список клиентов — свои карточки с реальным фото клиента через ClientAvatar (не таблица);
// 5) радиус (2026-07-30, два раунда правок подряд) — сперва максимально снизили округление
//    (rounded-full/2xl/3xl → md/lg/xl везде), затем по запросу "давай немного округленнее, но
//    потом скорее всего ещё будем менять" подняли на одну ступень: rounded-lg (пилюли, бейджи,
//    кнопки) / rounded-xl (карточки, таблицы, шаги воронки) / rounded-2xl (только featured-
//    панель метрики, самый крупный элемент страницы) — промежуточное значение между исходной
//    (full/2xl/3xl) и максимально плоской (md/lg/xl) версиями, ожидаемо не финальное.
export default function StudioProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [period, setPeriod] = useState<PrototypePeriodValue>({ period: 'today' });
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const { project, stats, funnel, recentClients, adBreakdown, leaderboards, canViewRevenue, canViewTeamLeaderboards, canViewPersonalBroadcasts } =
    usePrototypeProjectData(id, period);

  const metrics: { key: string; label: string; value: string | number; icon: LucideIcon; hue: StudioHueName; danger?: boolean }[] = [
    { key: 'newClients', label: 'Новые клиенты', value: stats?.newClients ?? '—', icon: Users, hue: 'amber' },
    // Отдельная плитка вместо скрытой подсказки под "Новые клиенты" (запрос пользователя
    // 2026-07-29: "не вижу где показывает отписки") — раньше это была dangerHint-строка внутри
    // featured-панели, видимая только когда "Новые клиенты" сама была выбрана пилюлей, поэтому
    // фактически терялась почти всегда. Теперь свой пункт в общем ряду, как и остальные метрики.
    { key: 'unsubscribed', label: 'Отписались', value: stats?.unsubscribedClients ?? '—', icon: Users, hue: 'plum', danger: true },
    { key: 'botActivated', label: 'Активировали бота', value: stats?.botActivatedClients ?? '—', icon: Bot, hue: 'slate' },
    ...(canViewRevenue
      ? [{ key: 'revenue', label: 'Выручка', value: stats ? `$${stats.totalRevenue.toFixed(2)}` : '—', icon: DollarSign, hue: 'sage' as StudioHueName }]
      : []),
    { key: 'conversion', label: 'Конверсия', value: stats ? `${stats.conversionRate}%` : '—', icon: Percent, hue: 'amber' },
    // Разделено на "наши" (из СРМ) и внешние (запрос пользователя 2026-07-29: "показывашь
    // только диалоги, а не диалоги из нашей срм, хотя они важнее") — раньше показывался только
    // totalDialogues (все источники вместе), из-за чего сама CRM-атрибуция диалога терялась.
    // Ярлык "Диалоги" без уточнения "(наши)" (уточнение того же дня) — раз внешние диалоги уже
    // подписаны отдельным пунктом, "(наши)" в первом стало избыточным.
    { key: 'crmDialogues', label: 'Диалоги', value: stats?.totalCrmDialogues ?? '—', icon: MessageCircle, hue: 'plum' },
    {
      key: 'externalDialogues',
      label: 'Внешние диалоги',
      value: stats ? stats.totalDialogues - stats.totalCrmDialogues : '—',
      icon: MessageCircle,
      hue: 'slate',
    },
    // Среднее время от подписки до диалога (запрос пользователя 2026-07-30: "нужна еще одна
    // статистика, среднее время которое проходит от подписки до диалога за разные периоды") —
    // реагирует на тот же PeriodSelector, что и остальные пилюли (backend уже фильтрует по
    // periodQuery, см. ClientsRepository.getProjectStats).
    {
      key: 'avgDialogueDelay',
      label: 'Ср. время до диалога',
      value: stats ? (stats.avgSubscribeToDialogueSeconds !== null ? formatSecondsDuration(stats.avgSubscribeToDialogueSeconds) : '—') : '—',
      icon: Timer,
      hue: 'teal',
    },
    { key: 'pageViews', label: 'Просмотры', value: stats?.totalPageViews ?? '—', icon: Eye, hue: 'slate' },
    { key: 'clicks', label: 'Клики', value: stats?.totalLeads ?? '—', icon: MousePointerClick, hue: 'teal' },
    { key: 'fd', label: 'Первый депозит', value: stats?.totalFd ?? '—', icon: Wallet, hue: 'sage' },
    { key: 'rd', label: 'Повторный депозит', value: stats?.totalRd ?? '—', icon: Repeat, hue: 'sage' },
  ];
  const [featuredKey, setFeaturedKey] = useState('newClients');
  const featured = metrics.find((m) => m.key === featuredKey) ?? metrics[0];

  // Топы — вкладки, не все 4 разом (запрос пользователя 2026-07-29: "показывай каждый отдельно
  // как мини вкладки, как в оригинале"), с тем же принципом ленивой подгрузки развёрнутой
  // воронки, что и в классической странице проекта — считается только для реально открытой
  // вкладки, не для всех 4 категорий сразу. Сами топ-5 списки уже пришли одним запросом с
  // staleTime: Infinity (usePrototypeProjectData) — это только про доп. воронку под элементами.
  const queryClient = useQueryClient();
  const periodParams =
    period.period === 'custom' ? { period: period.period, from: period.from, to: period.to } : { period: period.period };
  const [activeLeaderboardTab, setActiveLeaderboardTab] = useState<LeaderboardCategory>(
    canViewTeamLeaderboards ? 'buyers' : 'pixels',
  );

  // "Только свои клиенты" (запрос пользователя 2026-08-03) — см. тот же комментарий в
  // классической версии страницы.
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
    enabled: activeLeaderboardIds.length > 0,
    staleTime: Infinity,
  });
  const leaderboardFunnelById = new Map((leaderboardFunnel ?? []).map((r) => [r.id, r]));
  const refreshingLeaderboards = leaderboardFunnelLoading;
  const refreshLeaderboards = () => {
    queryClient.invalidateQueries({ queryKey: ['project', id, 'leaderboards'] });
    queryClient.invalidateQueries({ queryKey: ['project', id, 'leaderboard-funnel'] });
  };

  if (!project) return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3.5">
          {/* rounded-full на кольце-подложке сохранён намеренно (не тронут общей заменой на
              менее округлый дизайн) — ChannelAvatar сам всегда круглый (shared-компонент,
              rounded-full зашит внутри), квадратное кольцо вокруг круглого фото выглядело бы
              как рассинхрон форм. */}
          {project.channel?.type === 'TELEGRAM' && (
            <div className="p-1 rounded-full bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/10 shrink-0">
              <ChannelAvatar channelId={project.channel.id} hasAvatar={!!project.channel.tgAvatarFileId} fallbackLetter={project.name} />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">{project.name}</h1>
              <StatusPill active={project.status === 'ACTIVE'} label={project.status} />
              {project.channel && <StatusPill active={project.channel.isActive} label={project.channel.type} />}
              {/* "Молчащий" вебхук (запрос пользователя 2026-08-05) — см. классическую версию
                  для полного комментария. */}
              {project.channel?.webhookStale && (
                <span title="Telegram давно не присылал вебхуки этому боту — возможно, трафик не регистрируется">
                  <StudioPill danger>Нет вебхуков</StudioPill>
                </span>
              )}
              <TrackingEventsSummaryPill projectId={id} disabledTrackingEvents={project.disabledTrackingEvents} />
            </div>
            <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1">Прототип страницы проекта · бета</p>
          </div>
        </div>
        {/* Раньше вело на классическую версию этой же страницы внутри одного приложения — с
            переездом классики на old.mw-track.com (запрос пользователя 2026-07-30) это стало бы
            бессмысленной ссылкой саму на себя, поэтому теперь обычная внешняя ссылка на другой
            домен, а не Link. */}
        <a
          href={`https://old.mw-track.com/projects/${id}`}
          className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors underline-offset-4 hover:underline"
        >
          ← Обычный вид
        </a>
      </div>

      {/* Кнопки действий + период — один ряд с justify-between (запрос пользователя 2026-07-30:
          "стоят друг под другом слева и оно выглядит как пирамида") — раньше кнопки/статус
          трекинга/период шли тремя отдельными строками, каждая своей ширины, все прижаты к
          левому краю, из-за чего получалась убывающая "лестница". Теперь кнопки слева, период
          справа, в одном ряду — статус трекинга ушёл в компактную строку ниже, прижатую вправо
          (justify-end), а не влево, чтобы не продолжать тот же левый стек. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {/* Ведут на Studio-версии этих страниц, где они уже готовы (запрос пользователя
              2026-07-30: "готовить все остальные страницы") — Настройки пока без Studio-
              варианта (1575-строчный файл с десятком вкладок, отложен), ведёт на классику. */}
          <Link
            href={`/projects/${id}/pushes`}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] font-medium hover:opacity-90 transition-opacity"
          >
            <Send className="w-4 h-4" /> Рассылка
          </Link>
          {/* Рассылка с личного MTProto-аккаунта (запрос пользователя 2026-08-06) — та же
              гейтовка, что в классике: подключён личный аккаунт + право на просмотр раздела. */}
          {project?.channel?.tgPersonalConnected && canViewPersonalBroadcasts && (
            <Link
              href={`/projects/${id}/personal-broadcasts`}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors"
            >
              <Contact className="w-4 h-4" /> Личный аккаунт
            </Link>
          )}
          <Link
            href={`/projects/${id}/landings`}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors"
          >
            <LayoutTemplate className="w-4 h-4" /> Лендинги
          </Link>
          <Link
            href={`/projects/${id}/scenarios`}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors"
          >
            <Workflow className="w-4 h-4" /> Сценарии
          </Link>
          <Link
            href={`/projects/${id}/settings`}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors"
          >
            <Settings className="w-4 h-4" /> Настройки
          </Link>
        </div>

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
            {/* Кастомный период (запрос пользователя 2026-07-29: "в версии studio нет
                возможности выбрать период кастомный") — тот же принцип, что в PeriodSelector
                классической страницы, оформлен как ещё одна пилюля в общем ряду. */}
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

      {/* Метрики — не сетка разом, а featured-карточка + пилюли-переключатели (запрос
          пользователя 2026-07-28: "открывать отдельно, для большего места для статистики") */}
      <div className="space-y-3">
        {/* Сетка вместо flex-wrap (запрос пользователя 2026-07-30: "не во всю ширину основного
            контейнера") — фиксированная ширина пилюли (w-[178px]) решала прыжки при смене цифр,
            но при этом ряд не дотягивался до правого края контейнера и в последней строке
            оставался пустой хвост. auto-fit-колонки растягивают пилюли на всю ширину без
            возврата прыжков — ширина колонки теперь зависит от контейнера, а не от содержимого
            пилюли, так что число внутри по-прежнему не меняет её размер. */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
          {metrics.map((m) => {
            const { textClass, bgSoftClass } = STUDIO_HUES[m.hue];
            const active = m.key === featuredKey;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setFeaturedKey(m.key)}
                // justify-between прижимает значение к правому краю, label обрезается в
                // оставшемся месте.
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors justify-between ${
                  m.danger
                    ? active
                      ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400 font-medium'
                      : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
                    : active
                      ? `${bgSoftClass} ${textClass} font-medium`
                      : 'bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <m.icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline truncate">{m.label}</span>
                </span>
                <span className="font-mono tabular-nums font-semibold shrink-0">{m.value}</span>
              </button>
            );
          })}
        </div>

        {/* Уменьшено (запрос пользователя 2026-07-29: "сделай чуть поменьше") — было p-8/w-16/
            text-5xl, теперь более сдержанный размер, всё ещё крупнее обычных карточек. */}
        <div className="rounded-2xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-5 flex items-center gap-4">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              featured.danger ? 'bg-red-50 dark:bg-red-950/40' : STUDIO_HUES[featured.hue].bgSoftClass
            }`}
          >
            <featured.icon className={`w-5 h-5 ${featured.danger ? 'text-red-600 dark:text-red-400' : STUDIO_HUES[featured.hue].textClass}`} />
          </div>
          <div>
            <div className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">{featured.label}</div>
            <div
              className={`text-4xl font-bold font-mono tabular-nums mt-0.5 ${
                featured.danger ? 'text-red-600 dark:text-red-400' : 'text-[#131A24] dark:text-[#E9EDF3]'
              }`}
            >
              {featured.value}
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-4">Воронка конверсий</h2>
        <ConversionFunnel stages={funnel} />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-4">Динамика по дням</h2>
        {isSingleDayPeriod(period) ? (
          <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-5">
            Графики доступны для периода от 7 дней — на «Сегодня»/«Вчера» это была бы одна точка.
          </p>
        ) : (
          <DailyCharts
            stats={stats}
            periodLabel={PROTOTYPE_PERIOD_LABELS[period.period]}
            primaryLight={STUDIO_HUE_HEX.amber.light}
            primaryDark={STUDIO_HUE_HEX.amber.dark}
            secondaryLight={STUDIO_HUE_HEX.slate.light}
            secondaryDark={STUDIO_HUE_HEX.slate.dark}
            cardClassName="rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-5"
            titleClassName="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-3"
            legendClassName="flex items-center gap-4 text-xs text-[#5F6B7A] dark:text-[#92A0AF] mb-2"
            tabsListClassName="rounded-lg bg-[#E8ECF1] dark:bg-white/5 p-1 h-auto"
            tabsTriggerClassName="rounded-lg data-active:bg-[#1F4E9C] dark:data-active:bg-[#7BA9EE] data-active:text-white dark:data-active:text-[#0F1620] data-active:shadow-none"
          />
        )}
      </div>

      {!!adBreakdown?.length && (
        <div>
          <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-4">Разбивка по рекламе</h2>
          <div className="rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                  <th className="px-5 py-3 font-medium">Кампания</th>
                  <th className="px-5 py-3 font-medium text-right">Просмотры</th>
                  <th className="px-5 py-3 font-medium text-right">Клики</th>
                  <th className="px-5 py-3 font-medium text-right">Подписки</th>
                  <th className="px-5 py-3 font-medium text-right">Диалоги</th>
                  <th className="px-5 py-3 font-medium text-right">Покупки</th>
                  <th className="px-5 py-3 font-medium text-right">CR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
                {adBreakdown.slice(0, 10).map((row) => (
                  <tr key={row.campaignId}>
                    <td className="px-5 py-3 truncate max-w-[220px] text-[#131A24] dark:text-[#E9EDF3]">
                      {row.campaignName || row.campaignId}
                    </td>
                    <td className="px-5 py-3 text-right text-[#5F6B7A] dark:text-[#92A0AF]">{row.pageViews}</td>
                    <td className="px-5 py-3 text-right text-[#5F6B7A] dark:text-[#92A0AF]">{row.leads}</td>
                    <td className="px-5 py-3 text-right text-[#5F6B7A] dark:text-[#92A0AF]">{row.subscribes}</td>
                    <td className="px-5 py-3 text-right text-[#5F6B7A] dark:text-[#92A0AF]">{row.dialogues}</td>
                    <td className="px-5 py-3 text-right text-[#5F6B7A] dark:text-[#92A0AF]">{row.purchases}</td>
                    <td className="px-5 py-3 text-right font-medium text-[#1F4E9C] dark:text-[#7BA9EE]">{row.cr}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {leaderboards && (
        <div>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
            <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3]">Топы за период</h2>
            {/* Обновить вручную (запрос пользователя 2026-07-29: "как в оригинале" —
                staleTime: Infinity выше, данные сами по себе не перезапрашиваются). */}
            <button
              type="button"
              onClick={refreshLeaderboards}
              disabled={refreshingLeaderboards}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingLeaderboards ? 'animate-spin' : ''}`} />
              Обновить
            </button>
          </div>

          {/* Мини-вкладки, одна категория видна за раз (запрос пользователя 2026-07-29:
              "показывай каждый отдельно как мини вкладки, а не все сразу, как в оригинале") —
              топ-5 списки уже загружены одним запросом (staleTime: Infinity), здесь только
              переключение видимости + ленивая подгрузка развёрнутой воронки под элементами. */}
          <div className="inline-flex rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-1 gap-0.5 mb-4">
            {/* "Только свои клиенты" (запрос пользователя 2026-08-03) — та же логика, что и в
                классической версии: бэкенд отдаёт пустой buyers[] для скоуп-баера, прячем
                пилюлю целиком вместо пустого списка. */}
            {canViewTeamLeaderboards && leaderboards.buyers.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveLeaderboardTab('buyers')}
                className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
                  activeLeaderboardTab === 'buyers'
                    ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                    : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
                }`}
              >
                Топ баеров
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveLeaderboardTab('pixels')}
              className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
                activeLeaderboardTab === 'pixels'
                  ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                  : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
              }`}
            >
              Топ пикселей
            </button>
            <button
              type="button"
              onClick={() => setActiveLeaderboardTab('landings')}
              className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
                activeLeaderboardTab === 'landings'
                  ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                  : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
              }`}
            >
              Топ лендингов
            </button>
            <button
              type="button"
              onClick={() => setActiveLeaderboardTab('campaigns')}
              className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
                activeLeaderboardTab === 'campaigns'
                  ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                  : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
              }`}
            >
              Топ кампаний
            </button>
          </div>

          {activeLeaderboardTab === 'buyers' && canViewTeamLeaderboards && (
            <LeaderboardBlock
              title="Топ баеров"
              icon={Users}
              hue="amber"
              items={leaderboards.buyers.map((b) => ({
                id: b.buyerId,
                label: b.name,
                primary: `${b.clients} клиентов`,
                secondary: `$${b.revenue.toFixed(2)}`,
              }))}
              funnelById={leaderboardFunnelById}
              funnelLoading={leaderboardFunnelLoading}
            />
          )}
          {activeLeaderboardTab === 'pixels' && (
            <LeaderboardBlock
              title="Топ пикселей"
              icon={Target}
              hue="slate"
              items={leaderboards.pixels.map((p) => ({
                id: p.pixelId ?? p.label,
                label: p.label,
                primary: `${p.clients} клиентов`,
                secondary: `$${p.revenue.toFixed(2)}`,
              }))}
              funnelById={leaderboardFunnelById}
              funnelLoading={leaderboardFunnelLoading}
            />
          )}
          {activeLeaderboardTab === 'landings' && (
            <LeaderboardBlock
              title="Топ лендингов"
              icon={LayoutTemplate}
              hue="teal"
              items={leaderboards.landings.map((l) => ({
                id: l.landingId,
                label: l.name,
                primary: `${l.subscribers} подписок`,
                secondary: `$${l.revenue.toFixed(2)}`,
                previewId: l.landingId,
              }))}
              funnelById={leaderboardFunnelById}
              funnelLoading={leaderboardFunnelLoading}
            />
          )}
          {activeLeaderboardTab === 'campaigns' && (
            <LeaderboardBlock
              title="Топ кампаний"
              icon={Megaphone}
              hue="plum"
              items={leaderboards.campaigns.map((c) => ({
                id: c.campaignId,
                label: c.campaignName || c.campaignId,
                primary: `${c.clients} клиентов`,
                secondary: `$${c.revenue.toFixed(2)}`,
              }))}
              funnelById={leaderboardFunnelById}
              funnelLoading={leaderboardFunnelLoading}
            />
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3]">Последние клиенты</h2>
          <Link
            href={`/projects/${id}/clients`}
            className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors underline-offset-4 hover:underline"
          >
            Все клиенты →
          </Link>
        </div>
        {recentClients?.length === 0 ? (
          <div className="rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-5 text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
            Клиентов пока нет.
          </div>
        ) : (
          <StudioClientsTable projectId={id} clients={recentClients ?? []} onSelect={setSelectedClientId} />
        )}
      </div>

      <ClientDetailDrawer projectId={id} clientId={selectedClientId} onClose={() => setSelectedClientId(null)} />
    </div>
  );
}

// "Активно/работает" — зелёный (sage), а не янтарный (запрос пользователя 2026-07-29: "везде
// принято зелёным, а тут коричневым" — янтарь в этом дизайне зарезервирован за акцентом/
// выделением, не за семантикой статуса; клиентские карточки ниже уже красили активные статусы
// в sage правильно, здесь — этот же принцип, раньше пропущенный для StatusPill).
function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`text-[10px] font-medium px-2 py-0.5 rounded-lg ${
        active ? `${STUDIO_HUES.sage.bgSoftClass} ${STUDIO_HUES.sage.textClass}` : 'bg-[#DCE1E8] text-[#5F6B7A] dark:bg-white/5 dark:text-[#92A0AF]'
      }`}
    >
      {label}
    </span>
  );
}

// Свёрнутая сводка вместо ряда из 4 отдельных подписанных пилюль (запрос пользователя
// 2026-07-30: "занимают много места, надо куда-то в другое место и по-другому оформить") —
// один компактный значок в шапке рядом со StatusPill, кликабельный (ведёт на вкладку
// "События" в настройках, где реально живут переключатели — тот же принцип, что и у бейджа
// личного аккаунта, см. feedback_personal_account_indicator_and_channel_mode_badge). Список
// расшифровки — во всплывающем title, а не отдельными пилюлями на странице.
function TrackingEventsSummaryPill({ projectId, disabledTrackingEvents }: { projectId: string; disabledTrackingEvents: string[] }) {
  const enabledCount = TRACKING_EVENT_TYPES.filter((et) => !disabledTrackingEvents.includes(et.name)).length;
  const allEnabled = enabledCount === TRACKING_EVENT_TYPES.length;
  const tooltip = TRACKING_EVENT_TYPES.map((et) => `${et.label}: ${disabledTrackingEvents.includes(et.name) ? 'выключено' : 'включено'}`).join('\n');
  return (
    <Link
      href={`/projects/${projectId}/settings?tab=events`}
      title={tooltip}
      className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-lg transition-opacity hover:opacity-80 ${
        allEnabled ? `${STUDIO_HUES.sage.bgSoftClass} ${STUDIO_HUES.sage.textClass}` : 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-lg ${allEnabled ? 'bg-[#1F7A6C] dark:bg-[#6FCBBA]' : 'bg-red-500'}`} />
      События {enabledCount}/{TRACKING_EVENT_TYPES.length}
    </Link>
  );
}

// funnelById/funnelLoading — опционально, только для реально открытой вкладки (запрос
// пользователя 2026-07-29: "с такой же прогрузкой и конверсией как в оригинале"), та же
// ленивая подгрузка развёрнутой воронки, что и в классической странице проекта.
function LeaderboardBlock({
  title,
  icon: Icon,
  hue,
  items,
  funnelById,
  funnelLoading,
}: {
  title: string;
  icon: LucideIcon;
  hue: StudioHueName;
  items: { id: string; label: string; primary: string; secondary?: string; previewId?: string }[];
  funnelById?: Map<string, LeaderboardFunnelRow>;
  funnelLoading?: boolean;
}) {
  const { textClass, bgSoftClass } = STUDIO_HUES[hue];
  return (
    <div className="rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${bgSoftClass}`}>
          <Icon className={`w-3.5 h-3.5 ${textClass}`} />
        </div>
        <h3 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">{title}</h3>
      </div>
      {items.length === 0 && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Нет данных за период.</p>}
      <div className="space-y-3">
        {items.slice(0, 5).map((item, i) => {
          const itemFunnel = funnelById?.get(item.id);
          return (
            <div key={item.id}>
              <div className="flex items-center justify-between text-sm gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[#5F6B7A] dark:text-[#92A0AF] shrink-0">{i + 1}.</span>
                  <span className="truncate text-[#131A24] dark:text-[#E9EDF3]">{item.label}</span>
                  {item.previewId && (
                    <button
                      type="button"
                      onClick={() => previewLanding(item.previewId!)}
                      className="shrink-0 text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]"
                      title="Предпросмотр лендинга"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-medium text-[#131A24] dark:text-[#E9EDF3]">{item.primary}</div>
                  {item.secondary && <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">{item.secondary}</div>}
                </div>
              </div>
              {itemFunnel && <LeaderboardFunnelMini row={itemFunnel} />}
              {funnelLoading && !itemFunnel && (
                <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] mt-1.5 pt-1.5 border-t border-[#DCE1E8] dark:border-white/10">
                  Загрузка воронки...
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Компактная строка-воронка под элементом топа (запрос пользователя 2026-07-29: "с такой же...
// конверсией как в оригинале") — та же идея, что и LeaderboardFunnelMini классической страницы
// (иконка+число+% от предыдущего шага в ряд), в цветах Studio вместо литеральных hex-цветов
// оригинала.
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

function ConversionFunnel({ stages }: { stages?: PrototypeFunnelStage[] }) {
  if (!stages?.length) return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Нет данных за период.</p>;
  const maxCount = stages[0].count || 0;
  const last = stages[stages.length - 1];
  const overallRate = maxCount > 0 ? Math.round((last.count / maxCount) * 100 * 10) / 10 : 0;

  return (
    <div className="space-y-3">
      <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
        Итоговая конверсия:{' '}
        <span className="font-semibold text-[#131A24] dark:text-[#E9EDF3]">
          {overallRate}% ({stages[0].label} → {last.label})
        </span>
      </p>
      <div className="flex flex-col md:flex-row md:items-stretch gap-2">
        {stages.map((stage, i) => {
          const Icon = FUNNEL_ICON[stage.stage] ?? TrendingUp;
          const hue = FUNNEL_HUE[stage.stage] ?? 'amber';
          const { textClass, bgSoftClass } = STUDIO_HUES[hue];
          const fillPct = maxCount > 0 ? Math.round((stage.count / maxCount) * 100) : 0;
          return (
            <Fragment key={stage.stage}>
              {i > 0 && (
                <div className="flex items-center justify-center text-[#5F6B7A] dark:text-[#92A0AF] shrink-0">
                  <ChevronDown className="w-5 h-5 md:hidden" />
                  <ChevronRight className="w-5 h-5 hidden md:block" />
                </div>
              )}
              <div className="relative flex-1 min-w-0 rounded-xl overflow-hidden bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm">
                <div className={`absolute inset-y-0 left-0 ${bgSoftClass} transition-all`} style={{ width: `${fillPct}%` }} />
                <div className="relative p-4">
                  <div className="flex items-center gap-1.5 text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${textClass}`} />
                    <span className="truncate">{stage.label}</span>
                  </div>
                  <div className="text-xl font-bold mt-1.5 text-[#131A24] dark:text-[#E9EDF3]">{stage.count}</div>
                  {stage.rate !== undefined && <div className={`text-xs mt-0.5 font-medium ${textClass}`}>{stage.rate}% от предыдущего</div>}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

