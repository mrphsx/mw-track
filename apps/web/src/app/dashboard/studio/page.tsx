'use client';

import Link from 'next/link';
import { AlertTriangle, Bot, FolderOpen, Send, Users, LucideIcon } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { ChannelAvatar } from '@/components/channel-avatar';
import { getSubscriptionWarning, usePrototypeHomeData } from '@/lib/prototype-project-data';
import { STUDIO_HUES, StudioHueName } from './colors';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

// Прототип "Studio" — доступ/сайдбар/шапка в apps/web/src/app/dashboard/studio/layout.tsx,
// эта страница — только контент. Пользователь решил дальше дорабатывать именно этот вариант
// (2026-07-28: "давай остановимся пока на studio"), остальные два (Control Room/Ledger)
// заморожены как есть. Правки этого раунда: (1) у каждой метрики свой оттенок вместо
// единственного янтаря — см. colors.ts; (2) радиус — эксперимент по указанию пользователя
// ("всё слишком округлённо"): карточки метрик стали rounded-3xl (крупнее, ощутимее), карточки
// проектов — rounded-xl (заметно менее круглые, для контраста и чтобы влезало больше
// информации на той же площади).
export default function StudioDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { projects, isLoading, usage } = usePrototypeHomeData();
  const warning = getSubscriptionWarning(usage);

  const totalClients = projects?.reduce((sum, p) => sum + p._count.clients, 0) ?? 0;
  const totalPushes = projects?.reduce((sum, p) => sum + p._count.pushes, 0) ?? 0;
  const activeBots = projects?.reduce((sum, p) => sum + (p.channel?.isActive ? 1 : 0), 0) ?? 0;
  const totalProjects = projects?.length ?? 0;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">
          {greeting()}, {user?.firstName}
        </h1>
        <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1.5">Прототип нового дизайна · бета, видно только владельцам компании</p>
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
            <Link key={project.id} href={`/dashboard/studio/projects/${project.id}`}>
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
