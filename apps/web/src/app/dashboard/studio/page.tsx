'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bot, DollarSign, FolderOpen, Repeat, Send, UserX, Users, Wallet, LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { hasAnyPermission } from '@/lib/permissions';
import { ChannelAvatar } from '@/components/channel-avatar';
import { hasChannelAvatar } from '@/lib/landings';
import { getSubscriptionWarning, usePrototypeHomeData } from '@/lib/prototype-project-data';
import { toApiPeriodParams, useAudiencePeriodQueryState } from '@/lib/use-audience-period';
import { STUDIO_HUES, StudioHueName } from './colors';
import { StudioAudiencePeriodPicker } from './audience/period-picker';

// Клиенты/диалоги/ФД/РД/сумма за выбранный период — одна форма строки для карточки проекта,
// баера и источника (бэкенд считает все три одним хелпером, ProjectsService.aggregateByClientDimension).
interface PeriodRow {
  clients: number;
  dialogues: number;
  fd: number;
  rd: number;
  revenue: number;
}

interface CompanyStats {
  newClients: number;
  unsubscribedClients: number;
  botActivatedClients: number;
  totalRevenue: number;
  totalFd: number;
  totalRd: number;
  fdRevenue: number;
  rdRevenue: number;
  projectCount: number;
  byProject: Record<string, PeriodRow>;
  // null — нет права на рейтинг команды (или включено "только свои клиенты"), блок не показываем.
  buyers: (PeriodRow & { buyerId: string; name: string; isDeleted: boolean })[] | null;
  sources: (PeriodRow & { source: 'FACEBOOK' | 'TIKTOK' })[];
  // Клиенты и покупки без баера / без метки источника — отдельной строкой под таблицей.
  buyersUnattributed?: PeriodRow | null;
  sourcesUnattributed?: PeriodRow | null;
}

const SOURCE_LABEL: Record<'FACEBOOK' | 'TIKTOK', string> = { FACEBOOK: 'Facebook', TIKTOK: 'TikTok' };

function money(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

// Прототип "Studio" — доступ/сайдбар/шапка в apps/web/src/app/layout.tsx,
// эта страница — только контент. Пользователь решил дальше дорабатывать именно этот вариант
// (2026-07-28: "давай остановимся пока на studio"), остальные два (Control Room/Ledger)
// заморожены как есть. Правки этого раунда: (1) у каждой метрики свой оттенок вместо
// единственного янтаря — см. colors.ts; (2) радиус — эксперимент по указанию пользователя
// ("всё слишком округлённо"): карточки метрик стали rounded-3xl (крупнее, ощутимее), карточки
// проектов — rounded-xl (заметно менее круглые, для контраста и чтобы влезало больше
// информации на той же площади).
export default function StudioDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const canViewRevenue = hasAnyPermission(user, 'STATS_VIEW_REVENUE');
  const { projects, isLoading, usage } = usePrototypeHomeData();
  const now = useMinuteClock();
  const warning = getSubscriptionWarning(usage);

  const totalClients = projects?.reduce((sum, p) => sum + p._count.clients, 0) ?? 0;
  const totalPushes = projects?.reduce((sum, p) => sum + p._count.pushes, 0) ?? 0;
  const activeBots = projects?.reduce((sum, p) => sum + (p.channel?.isActive ? 1 : 0), 0) ?? 0;
  const totalProjects = projects?.length ?? 0;

  // По умолчанию "Всё время" (запрос пользователя 2026-10-14) — тот же хук с пунктом 'all', что
  // на страницах пересечения аудиторий; при 'all' бэкенду период не передаётся вовсе.
  const [period, setPeriod] = useAudiencePeriodQueryState('all');
  const periodReady = period.period !== 'custom' || (!!period.from && !!period.to);
  const periodParams = toApiPeriodParams(period);

  // Запрос пользователя 2026-08-06: "нужно на главной странице так же показать какую-то
  // статистику... кассы, клиентов, фд/рд" — см. полный комментарий в classic-версии
  // (apps/web/src/app/(dashboard)/page.tsx).
  const { data: companyStats } = useQuery({
    queryKey: ['company-stats', periodParams],
    queryFn: async () => (await api.get<CompanyStats>('/projects/company-stats', { params: periodParams })).data,
    enabled: periodReady,
  });

  return (
    <div className="space-y-6 sm:space-y-10">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">
          {greeting()}, {user?.firstName}
        </h1>
        {/* Раньше "видно только владельцам компании" — с 2026-07-30 Studio основной дизайн для
            всех ролей (см. project_dashboard_redesign_exploration), эта строка была неверной. */}
        <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1.5">Studio · бета</p>
      </div>

      {warning && (
        <div className="flex items-center gap-3 rounded-2xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm px-5 py-4">
          <AlertTriangle className="w-4.5 h-4.5 text-[#1F4E9C] dark:text-[#7BA9EE] shrink-0" />
          <p className="min-w-0 text-sm text-[#131A24] dark:text-[#E9EDF3]">
            {warning.expired
              ? 'Срок подписки истёк — функции ограничены до автопродления или сброса до TRIAL.'
              : warning.plan === 'TRIAL'
                ? `Триал заканчивается через ${warning.daysLeft} дн.`
                : `Автопродление через ${warning.daysLeft} дн. — проверьте баланс.`}
          </p>
          <Link href="/billing" className="ml-auto text-xs font-medium text-[#1F4E9C] dark:text-[#7BA9EE] underline-offset-4 hover:underline shrink-0">
            Оплатить
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Клиентов" value={totalClients} icon={Users} hue="amber" />
        <StatCard label="Проектов" value={`${usage?.currentProjects ?? totalProjects}/${usage?.maxProjects ?? '—'}`} icon={FolderOpen} hue="slate" />
        <StatCard label="Рассылок" value={totalPushes} icon={Send} hue="teal" />
        <StatCard label="Активных ботов" value={`${activeBots}/${totalProjects}`} icon={Bot} hue="sage" />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3]">Статистика по всем проектам</h2>
          <StudioAudiencePeriodPicker value={period} onChange={setPeriod} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard label="Новые клиенты" value={companyStats?.newClients ?? '—'} icon={Users} hue="amber" />
          <StatCard label="Отписались" value={companyStats?.unsubscribedClients ?? '—'} icon={UserX} hue="plum" />
          <StatCard label="Активировали бота" value={companyStats?.botActivatedClients ?? '—'} icon={Bot} hue="slate" />
          {canViewRevenue && (
            <StatCard label="Выручка" value={companyStats ? `$${companyStats.totalRevenue.toFixed(2)}` : '—'} icon={DollarSign} hue="sage" />
          )}
          <StatCard label="Первый депозит" value={companyStats?.totalFd ?? '—'} icon={Wallet} hue="sage" />
          <StatCard label="Повторный депозит" value={companyStats?.totalRd ?? '—'} icon={Repeat} hue="sage" />
        </div>
      </div>

      {companyStats && (
        <div className={`grid grid-cols-1 gap-4 ${companyStats.buyers ? 'xl:grid-cols-2' : ''}`}>
          {companyStats.buyers && (
            <PeriodTable
              title="Топ-5 баеров"
              firstColumn="Баер"
              canViewRevenue={canViewRevenue}
              empty="За этот период у баеров нет клиентов"
              rows={companyStats.buyers.map((b, i) => ({
                key: b.buyerId,
                label: (
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-5 shrink-0 text-xs text-[#5F6B7A] dark:text-[#92A0AF] tabular-nums">{i + 1}</span>
                    <span
                      className={`truncate ${b.isDeleted ? 'text-red-600 dark:text-red-400' : ''}`}
                      title={b.isDeleted ? 'Удалённый пользователь' : b.name}
                    >
                      {b.name}
                    </span>
                  </span>
                ),
                row: b,
              }))}
              footer={companyStats.buyersUnattributed ? { label: 'Без баера', row: companyStats.buyersUnattributed } : undefined}
            />
          )}
          <PeriodTable
            title="Источники"
            firstColumn="Источник"
            canViewRevenue={canViewRevenue}
            empty=""
            rows={companyStats.sources.map((src) => ({ key: src.source, label: SOURCE_LABEL[src.source], row: src }))}
            footer={companyStats.sourcesUnattributed ? { label: 'Без источника', row: companyStats.sourcesUnattributed } : undefined}
          />
        </div>
      )}

      <div>
        <div className="flex items-baseline gap-2 mb-4">
          <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3]">Проекты</h2>
          <span className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">цифры за выбранный период</span>
        </div>
        {isLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}
        {!isLoading && projects?.length === 0 && (
          <div className="rounded-3xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-10 text-center text-[#5F6B7A] dark:text-[#92A0AF]">
            Пока нет ни одного проекта.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {projects?.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <div className="rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm hover:shadow-md transition-shadow p-4">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {project.channel?.type === 'TELEGRAM' || project.channel?.type === 'WEBSITE' ? (
                      <ChannelAvatar channelId={project.channel.id} hasAvatar={hasChannelAvatar(project.channel)} fallbackLetter={project.name} />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[#52606B]/10 dark:bg-[#A6B4C0]/10 flex items-center justify-center text-xs font-medium text-[#52606B] dark:text-[#A6B4C0] shrink-0">
                        {project.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="font-medium truncate text-[#131A24] dark:text-[#E9EDF3]">{project.name}</span>
                  </div>
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                      project.status === 'ACTIVE'
                        ? 'bg-[#1F7A6C]/10 text-[#1F7A6C] dark:bg-[#6FCBBA]/10 dark:text-[#6FCBBA]'
                        : 'bg-[#DCE1E8] text-[#5F6B7A] dark:bg-white/5 dark:text-[#92A0AF]'
                    }`}
                  >
                    {project.status}
                  </span>
                </div>
                <ProjectPeriodMetrics row={companyStats?.byProject[project.id]} canViewRevenue={canViewRevenue} />
                {project.timezone && <ProjectDayProgress timezone={project.timezone} now={now} />}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// Текущее время, обновляемое раз в минуту — один таймер на всю страницу, а не на каждую
// карточку. До монтирования null, чтобы серверный рендер и гидрация совпадали.
function useMinuteClock(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// Сколько прошло текущих суток в часовом поясе проекта (запрос пользователя 2026-10-20):
// «Сегодня» в статистике проекта считается от полуночи по его времени, и полоса показывает,
// какую часть этих суток уже видно в цифрах.
function ProjectDayProgress({ timezone, now }: { timezone: string; now: Date | null }) {
  if (!now) return null;
  let hours: number;
  let minutes: number;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    hours = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    minutes = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  } catch {
    return null; // неизвестный пояс — просто не показываем полосу
  }
  const percent = Math.round(((hours * 60 + minutes) / 1440) * 100);
  const time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return (
    <div
      className="mt-3"
      title={`Сейчас у проекта ${time} (${timezone}). «Сегодня» в статистике считается с полуночи по его времени — прошло ${percent}% суток.`}
    >
      <div className="flex items-baseline justify-between text-[10px] leading-none text-[#5F6B7A] dark:text-[#92A0AF] mb-1">
        <span>У проекта {time}</span>
        <span className="tabular-nums">день прошёл на {percent}%</span>
      </div>
      <div className="h-1 rounded-full bg-[#DCE1E8] dark:bg-white/10 overflow-hidden">
        <div className="h-full rounded-full bg-[#7BA9EE]/70 dark:bg-[#7BA9EE]/60" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

// Клиенты/диалоги/ФД/РД (+ сумма при праве на выручку) проекта за выбранный период.
function ProjectPeriodMetrics({ row, canViewRevenue }: { row: PeriodRow | undefined; canViewRevenue: boolean }) {
  const items: { label: string; value: string }[] = [
    { label: 'Клиенты', value: row ? String(row.clients) : '—' },
    { label: 'Диалоги', value: row ? String(row.dialogues) : '—' },
    { label: 'ФД', value: row ? String(row.fd) : '—' },
    { label: 'РД', value: row ? String(row.rd) : '—' },
  ];
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-4 gap-2">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-[11px] text-[#5F6B7A] dark:text-[#92A0AF] truncate">{item.label}</dt>
            <dd className="text-sm font-semibold tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{item.value}</dd>
          </div>
        ))}
      </dl>
      {canViewRevenue && (
        <div className="flex items-baseline justify-between border-t border-[#DCE1E8] dark:border-white/10 pt-2">
          <span className="text-[11px] text-[#5F6B7A] dark:text-[#92A0AF]">Сумма</span>
          <span className="text-sm font-semibold tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{row ? money(row.revenue) : '—'}</span>
        </div>
      )}
    </div>
  );
}

function PeriodTable({
  title,
  firstColumn,
  rows,
  canViewRevenue,
  empty,
  footer,
}: {
  title: string;
  firstColumn: string;
  rows: { key: string; label: React.ReactNode; row: PeriodRow }[];
  canViewRevenue: boolean;
  empty: string;
  // Остаток без метки (без баера / без источника) — не участвует в рейтинге, показывается,
  // только если в нём что-то есть.
  footer?: { label: string; row: PeriodRow };
}) {
  const showFooter = !!footer && (footer.row.clients > 0 || footer.row.dialogues > 0 || footer.row.fd > 0 || footer.row.rd > 0 || footer.row.revenue > 0);
  const head = 'px-3 py-2.5 text-right font-medium';
  const cell = 'px-3 py-2.5 text-right tabular-nums';
  return (
    <div className="rounded-3xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-5 min-w-0">
      <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-3">{title}</h2>
      {rows.length === 0 && !showFooter ? (
        <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                <th className="px-3 py-2.5 text-left font-medium">{firstColumn}</th>
                <th className={head}>Клиенты</th>
                <th className={head}>Диалоги</th>
                <th className={head}>ФД</th>
                <th className={head}>РД</th>
                {canViewRevenue && <th className={head}>Сумма</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10 text-[#131A24] dark:text-[#E9EDF3]">
              {rows.map(({ key, label, row }) => (
                <tr key={key}>
                  <td className="px-3 py-2.5 max-w-[14rem]">{label}</td>
                  <td className={cell}>{row.clients}</td>
                  <td className={cell}>{row.dialogues}</td>
                  <td className={cell}>{row.fd}</td>
                  <td className={cell}>{row.rd}</td>
                  {canViewRevenue && <td className={`${cell} font-semibold`}>{money(row.revenue)}</td>}
                </tr>
              ))}
              {showFooter && footer && (
                <tr className="text-[#5F6B7A] dark:text-[#92A0AF] border-t border-dashed border-[#DCE1E8] dark:border-white/10">
                  <td className="px-3 py-2.5 italic">{footer.label}</td>
                  <td className={cell}>{footer.row.clients}</td>
                  <td className={cell}>{footer.row.dialogues}</td>
                  <td className={cell}>{footer.row.fd}</td>
                  <td className={cell}>{footer.row.rd}</td>
                  {canViewRevenue && <td className={`${cell} font-semibold`}>{money(footer.row.revenue)}</td>}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, hue }: { label: string; value: string | number; icon: LucideIcon; hue: StudioHueName }) {
  const { textClass, bgSoftClass } = STUDIO_HUES[hue];
  return (
    <div className="rounded-3xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-4 sm:p-5 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] truncate">{label}</div>
        <div className="text-xl sm:text-2xl font-bold mt-1 text-[#131A24] dark:text-[#E9EDF3] truncate">{value}</div>
      </div>
      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${bgSoftClass}`}>
        <Icon className={`w-4.5 h-4.5 ${textClass}`} />
      </div>
    </div>
  );
}
