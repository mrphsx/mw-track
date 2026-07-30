'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderOpen,
  LayoutTemplate,
  Globe,
  CreditCard,
  Settings,
  Users,
  Layers,
  CalendarDays,
  Camera,
  ChevronDown,
  Sparkle,
  LogOut,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { hasAnyPermission } from '@/lib/permissions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Тот же список пунктов, что у классического Sidebar — продублирован намеренно (своя
// палитра/форма). Все пункты теперь ведут на Studio-версии (см.
// [[project_dashboard_redesign_exploration]]) — "Проекты" получил собственную страницу
// 2026-07-30 (запрос "сделай под новый дизайн ... страницу проектов"), до этого считался
// покрытым "Обзором", но тот — упрощённый агрегатный вид без части полей.
const navItems = [
  { href: '/dashboard/studio', label: 'Обзор', icon: LayoutDashboard },
  { href: '/dashboard/studio/projects', label: 'Проекты', icon: FolderOpen },
  { href: '/dashboard/studio/pushes-calendar', label: 'Календарь рассылок', icon: CalendarDays, requiredPermission: 'PUSHES_VIEW' as const },
  { href: '/dashboard/studio/stories', label: 'Истории', icon: Camera, requiredPermission: 'CHANNEL_VIEW' as const },
  { href: '/dashboard/studio/landings', label: 'Лендинги', icon: LayoutTemplate, requiredPermission: 'LANDINGS_VIEW' as const },
  { href: '/dashboard/studio/audience', label: 'Пересечение аудиторий', icon: Layers },
  { href: '/dashboard/studio/domains', label: 'Домены', icon: Globe, requiredPermission: 'DOMAINS_VIEW' as const },
  { href: '/dashboard/studio/team', label: 'Команда', icon: Users, ownerAdminOnly: true },
  { href: '/dashboard/studio/billing', label: 'Подписка', icon: CreditCard },
  { href: '/dashboard/studio/settings', label: 'Настройки', icon: Settings },
];

// Тёплая палитра "Studio" — кремовый фон вместо нейтрального bg-background/bg-card (те
// остаются серыми даже в тёмной теме, см. globals.css), поэтому здесь свои литеральные цвета
// с dark:-вариантами вместо семантических токенов, тот же приём, что и у teal-акцента в
// Control Room, просто применённый шире (весь фон/карточки, не только акцент).
export function StudioSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const isOwnerOrAdmin = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  return (
    <aside className="w-64 border-r border-[#DCE1E8] dark:border-[#232B38] bg-[#E8ECF1] dark:bg-[#0B121B] flex flex-col h-screen shrink-0">
      <div className="p-5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-[#1F4E9C] dark:bg-[#7BA9EE] rounded-2xl flex items-center justify-center shrink-0">
            <Sparkle className="w-4.5 h-4.5 text-white dark:text-[#0F1620]" />
          </div>
          <div className="min-w-0">
            <span className="font-bold text-lg leading-none text-[#131A24] dark:text-[#E9EDF3]">MWTRACK</span>
            <div className="text-[9px] font-medium uppercase tracking-widest text-[#1F4E9C] dark:text-[#7BA9EE] mt-0.5">Studio</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3.5 space-y-1 overflow-y-auto">
        {navItems
          .filter((item) => !item.ownerAdminOnly || isOwnerOrAdmin)
          .filter((item) => !item.requiredPermission || hasAnyPermission(user, item.requiredPermission))
          .map((item) => {
            const active = item.href === '/dashboard/studio' ? pathname === '/dashboard/studio' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-sm transition-colors ${
                  active
                    ? 'bg-[#1F4E9C]/10 text-[#1F4E9C] font-medium dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]'
                    : 'text-[#5F6B7A] hover:bg-[#DCE1E8]/60 dark:text-[#92A0AF] dark:hover:bg-white/5'
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
      </nav>

      <div className="p-3.5">
        <DropdownMenu>
          <DropdownMenuTrigger className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl hover:bg-[#DCE1E8]/60 dark:hover:bg-white/5">
            <div className="w-8 h-8 rounded-full bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/10 flex items-center justify-center text-[#1F4E9C] dark:text-[#7BA9EE] font-medium text-sm shrink-0">
              {user?.firstName?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-medium truncate text-[#131A24] dark:text-[#E9EDF3]">{user?.firstName}</div>
              <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] truncate">{user?.role}</div>
            </div>
            <ChevronDown className="w-4 h-4 text-[#5F6B7A] dark:text-[#92A0AF]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {/* Тема перенесена в шапку как Switch (запрос пользователя 2026-07-29) — здесь
                больше не дублируется. */}
            <DropdownMenuItem onClick={logout} className="text-destructive">
              <LogOut className="w-4 h-4 mr-2" />
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
