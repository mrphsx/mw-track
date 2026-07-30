'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useQuery } from '@tanstack/react-query';
import { Bell, Moon, Sun, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { StudioSidebar } from '@/components/layout/studio-sidebar';
import { DesignModeToggle } from '@/components/layout/design-mode-toggle';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const PLAN_LABELS: Record<string, string> = {
  TRIAL: 'Триал',
  STARTER: 'Starter',
  GROWTH: 'Growth',
  SCALE: 'Scale',
  ENTERPRISE: 'Enterprise',
};

interface ProjectSummary {
  id: string;
  name: string;
  channel: { isActive: boolean } | null;
}

// Шелл дизайна "Studio" — единственный оставшийся вариант нового дизайна (запрос пользователя
// 2026-07-30: "удали полностью страницу дизайнов всех остальных" — галерея /dashboard и
// остальные варианты (Control Room/Brutal/Ledger) удалены целиком). Доступ проверяет общий
// apps/web/src/app/dashboard/layout.tsx выше по дереву — здесь только сайдбар/шапка этого
// дизайна, в тёплой палитре (см. studio-sidebar.tsx).
//
// Переключатель "← Все варианты" (вёл на удалённую галерею) заменён на общий `DesignModeToggle`
// (запрос того же дня: "добавь переключатель в header, где можно будет в один клик переключать
// дизайн") — тот же компонент используется и в классической шапке, см. его комментарий.
//
// Правки раунда 2026-07-29 ("перенеси смену темы наверх и сделай как свитч", "добавь красиво
// баланс так же сверху, иконку оповещений и подписку тоже"):
// - Тема — раньше выпадающее меню (light/dark/system) внизу сайдбара, теперь бинарный Switch
//   в шапке (StudioSidebar лишился этого блока целиком, не дублируем — "system" как отдельный
//   пункт ушёл, Switch по своей природе бинарный, resolvedTheme решает начальное положение).
// - Уведомления — реальные данные (истекающая подписка + отключённые боты проектов, не
//   выдуманные), оформлены под тёплую палитру Studio.
// - Баланс/план — пилюли в духе остальных элементов Studio (rounded-full, белая карточка с
//   мягкой тенью), а не отдельная плотная строка-реестр, как в Ledger.
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === 'dark';

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });
  const inactiveProjects = (projects ?? []).filter((p) => p.channel && !p.channel.isActive);

  const daysLeft = user?.company?.planExpiresAt
    ? Math.ceil((new Date(user.company.planExpiresAt).getTime() - Date.now()) / 86_400_000)
    : null;
  const expiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;

  const notifications: string[] = [
    ...(expiringSoon ? [`Подписка истекает через ${daysLeft} дн.`] : []),
    ...inactiveProjects.map((p) => `Бот проекта «${p.name}» отключён`),
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-[#F3F5F8] dark:bg-[#0F1620]">
      <StudioSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 flex items-center justify-between px-8 shrink-0 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[10px] font-medium uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE] shrink-0">
              Beta
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <DesignModeToggle mode="studio" mutedClassName="text-[#5F6B7A] dark:text-[#92A0AF]" />
            {user?.company && (
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-sm">
                <Wallet className="w-3.5 h-3.5 text-[#1F7A6C] dark:text-[#6FCBBA] shrink-0" />
                <span className="font-mono tabular-nums font-semibold text-[#131A24] dark:text-[#E9EDF3]">
                  ${Number(user.company.balance).toFixed(2)}
                </span>
              </div>
            )}

            {user?.company?.plan && (
              <span
                className={`hidden md:inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full shadow-sm ${
                  expiringSoon
                    ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400'
                    : 'bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 text-[#5F6B7A] dark:text-[#92A0AF]'
                }`}
              >
                {PLAN_LABELS[user.company.plan] || user.company.plan}
                {daysLeft !== null && <span className="opacity-70">· {daysLeft} дн.</span>}
              </span>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger className="relative w-9 h-9 flex items-center justify-center rounded-full bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors">
                <Bell className="w-4 h-4" />
                {notifications.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {notifications.length}
                  </span>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {notifications.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Всё в порядке</div>}
                {notifications.map((n, i) => (
                  <DropdownMenuItem key={i} className="text-sm">
                    {n}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center gap-1.5 pl-1 pr-1">
              <Sun className="w-3.5 h-3.5 text-[#5F6B7A] dark:text-[#92A0AF] shrink-0" />
              <Switch checked={isDark} onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')} />
              <Moon className="w-3.5 h-3.5 text-[#5F6B7A] dark:text-[#92A0AF] shrink-0" />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-8 pb-10">{children}</main>
      </div>
    </div>
  );
}
