'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bot, DollarSign, FolderOpen, Repeat, Send, UserX, Users, Wallet, LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { hasAnyPermission } from '@/lib/permissions';
import { ChannelAvatar } from '@/components/channel-avatar';
import { Input } from '@/components/ui/input';
import {
  getSubscriptionWarning,
  usePrototypeHomeData,
  PROTOTYPE_PERIOD_OPTIONS,
  PrototypePeriod,
  PrototypePeriodValue,
} from '@/lib/prototype-project-data';
import { STUDIO_HUES, StudioHueName } from './colors';

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
}

const PERIOD_VALUES = ['today', 'yesterday', '7d', '30d', 'custom'] as const;

// URL-персистентность периода (запрос пользователя 2026-08-06) — впервые портирован в Studio на
// главную страницу тот же приём, что уже есть на классической странице проекта; сама страница
// проекта Studio (в отличие от неё) этот приём ещё не использует, см. находки перед реализацией.
function readPeriodFromSearchParams(params: URLSearchParams): PrototypePeriodValue {
  const period = params.get('period');
  if (period === 'custom') {
    const from = params.get('from') || undefined;
    const to = params.get('to') || undefined;
    if (from && to) return { period: 'custom', from, to };
  }
  if (period && (PERIOD_VALUES as readonly string[]).includes(period)) return { period: period as PrototypePeriod };
  return { period: 'today' };
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const canViewRevenue = hasAnyPermission(user, 'STATS_VIEW_REVENUE');
  const { projects, isLoading, usage } = usePrototypeHomeData();
  const warning = getSubscriptionWarning(usage);

  const totalClients = projects?.reduce((sum, p) => sum + p._count.clients, 0) ?? 0;
  const totalPushes = projects?.reduce((sum, p) => sum + p._count.pushes, 0) ?? 0;
  const activeBots = projects?.reduce((sum, p) => sum + (p.channel?.isActive ? 1 : 0), 0) ?? 0;
  const totalProjects = projects?.length ?? 0;

  const [period, setPeriodState] = useState<PrototypePeriodValue>(() => readPeriodFromSearchParams(searchParams));
  const setPeriod = (next: PrototypePeriodValue) => {
    setPeriodState(next);
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
  const periodReady = period.period !== 'custom' || (!!period.from && !!period.to);
  const periodParams = period.period === 'custom' ? { period: period.period, from: period.from, to: period.to } : { period: period.period };

  // Запрос пользователя 2026-08-06: "нужно на главной странице так же показать какую-то
  // статистику... кассы, клиентов, фд/рд" — см. полный комментарий в classic-версии
  // (apps/web/src/app/(dashboard)/page.tsx).
  const { data: companyStats } = useQuery({
    queryKey: ['company-stats', periodParams],
    queryFn: async () => (await api.get<CompanyStats>('/projects/company-stats', { params: periodParams })).data,
    enabled: periodReady,
  });

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">
          {greeting()}, {user?.firstName}
        </h1>
        {/* Раньше "видно только владельцам компании" — с 2026-07-30 Studio основной дизайн для
            всех ролей (см. project_dashboard_redesign_exploration), эта строка была неверной. */}
        <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1.5">Studio · бета</p>
      </div>

      {warning && (
        <div className="flex items-center gap-3 rounded-2xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm px-5 py-4">
          <AlertTriangle className="w-4.5 h-4.5 text-[#1F4E9C] dark:text-[#7BA9EE] shrink-0" />
          <p className="text-sm text-[#131A24] dark:text-[#E9EDF3]">
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Клиентов" value={totalClients} icon={Users} hue="amber" />
        <StatCard label="Проектов" value={`${usage?.currentProjects ?? totalProjects}/${usage?.maxProjects ?? '—'}`} icon={FolderOpen} hue="slate" />
        <StatCard label="Рассылок" value={totalPushes} icon={Send} hue="teal" />
        <StatCard label="Активных ботов" value={`${activeBots}/${totalProjects}`} icon={Bot} hue="sage" />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3]">Статистика по всем проектам</h2>
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

      <div>
        <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-4">Проекты</h2>
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
                    {project.channel?.type === 'TELEGRAM' ? (
                      <ChannelAvatar channelId={project.channel.id} hasAvatar={!!project.channel.tgAvatarFileId} fallbackLetter={project.name} />
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
                <div className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
                  {project._count.clients} клиентов · {project._count.pushes} рассылок
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, hue }: { label: string; value: string | number; icon: LucideIcon; hue: StudioHueName }) {
  const { textClass, bgSoftClass } = STUDIO_HUES[hue];
  return (
    <div className="rounded-3xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-5 flex items-start justify-between">
      <div>
        <div className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">{label}</div>
        <div className="text-2xl font-bold mt-1 text-[#131A24] dark:text-[#E9EDF3]">{value}</div>
      </div>
      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${bgSoftClass}`}>
        <Icon className={`w-4.5 h-4.5 ${textClass}`} />
      </div>
    </div>
  );
}
