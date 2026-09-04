'use client';

import { useEffect, useState } from 'react';
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
  Send,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Sparkle,
  LogOut,
  BarChart3,
  BookOpen,
  Contact,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useUiStore } from '@/store/ui.store';
import { hasAnyPermission, Permission } from '@/lib/permissions';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  requiredPermission?: Permission;
  ownerAdminOnly?: boolean;
  // Строже, чем ownerAdminOnly (запрос пользователя 2026-08-29: "должен видеть только owner,
  // даже для админа выключи") — журнал реквизитов не должен быть виден даже Admin/Super Admin/
  // Operator-admin, не только Buyer/Operator.
  ownerOnly?: boolean;
}
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Тот же список пунктов, что у классического Sidebar — продублирован намеренно (своя
// палитра/форма). "Голые" пути без префикса /dashboard/studio (запрос пользователя 2026-07-30:
// "путь / должен вести сразу на новый дизайн") — физически файлы страниц по-прежнему лежат
// под apps/web/src/app/dashboard/studio/**, но apps/web/src/middleware.ts на основном домене
// прозрачно подставляет префикс обратно перед резолвом, так что в адресной строке остаётся
// чистый путь. На old.mw-track.com (классика) middleware ничего не переписывает — см. его
// комментарий.
const navItems: NavItem[] = [
  { href: '/', label: 'Обзор', icon: LayoutDashboard },
  { href: '/projects', label: 'Проекты', icon: FolderOpen },
  { href: '/pushes-calendar', label: 'Рассылки', icon: Send, requiredPermission: 'PUSHES_VIEW' as const },
  { href: '/stories', label: 'Истории', icon: Camera, requiredPermission: 'CHANNEL_VIEW' as const },
  { href: '/landings', label: 'Лендинги', icon: LayoutTemplate, requiredPermission: 'LANDINGS_VIEW' as const },
  { href: '/audience', label: 'Пересечение аудиторий', icon: Layers },
  { href: '/domains', label: 'Домены', icon: Globe, requiredPermission: 'DOMAINS_VIEW' as const },
  { href: '/team', label: 'Команда', icon: Users, ownerAdminOnly: true },
  // Журнал реквизитов (запрос пользователя 2026-08-29) — та же гейтовка, что в классике.
  { href: '/payment-details-log', label: 'Журнал реквизитов', icon: Contact, ownerOnly: true },
  { href: '/billing', label: 'Подписка', icon: CreditCard },
  { href: '/docs', label: 'Документация', icon: BookOpen },
  { href: '/settings', label: 'Настройки', icon: Settings },
];

// Жёстко ограниченный сайдбар для Operator — см. тот же комментарий в classic sidebar.tsx
// (3-й пункт добавлен запросом пользователя 2026-08-14).
const OPERATOR_NAV_ITEMS: NavItem[] = [
  { href: '/my-clients', label: 'Клиенты', icon: Users },
  { href: '/my-stats', label: 'Моя статистика', icon: BarChart3 },
  { href: '/my-personal-broadcasts', label: 'Личный аккаунт', icon: Contact },
];

// Тёплая палитра "Studio" — кремовый фон вместо нейтрального bg-background/bg-card (те
// остаются серыми даже в тёмной теме, см. globals.css), поэтому здесь свои литеральные цвета
// с dark:-вариантами вместо семантических токенов, тот же приём, что и у teal-акцента в
// Control Room, просто применённый шире (весь фон/карточки, не только акцент).
export function StudioSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar } = useUiStore();
  // До маунта — всегда развёрнут (совпадает с SSR-рендером, где localStorage ещё не прочитан) —
  // тот же приём, что и у иконки темы чуть ниже по коду (mounted-гейт), иначе первый клиентский
  // рендер разошёлся бы с серверным и React пожаловался бы на hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const collapsed = mounted && sidebarCollapsed;

  const isOwnerOrAdmin =
    user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'OPERATOR_ADMIN';
  const items = user?.role === 'OPERATOR' ? OPERATOR_NAV_ITEMS : navItems;

  return (
    <aside
      className={`relative border-r border-[#DCE1E8] dark:border-[#232B38] bg-[#E8ECF1] dark:bg-[#0B121B] flex flex-col h-screen shrink-0 transition-[width] duration-200 ${
        collapsed ? 'w-[76px]' : 'w-64'
      }`}
    >
      {/* Сворачивание до иконок (запрос пользователя 2026-07-31: "освободить много места для
          страниц") — кнопка на границе сайдбара, тот же паттерн, что в большинстве дашбордов
          (VSCode/Notion и т.п.). */}
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
        className="absolute -right-3 top-7 z-10 w-6 h-6 rounded-full bg-white dark:bg-[#171F2B] border border-[#DCE1E8] dark:border-white/10 shadow-sm flex items-center justify-center text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors"
      >
        {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>

      <div className="p-5">
        <div className={`flex items-center gap-2.5 ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-9 h-9 bg-[#1F4E9C] dark:bg-[#7BA9EE] rounded-2xl flex items-center justify-center shrink-0">
            <Sparkle className="w-4.5 h-4.5 text-white dark:text-[#0F1620]" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="font-bold text-lg leading-none text-[#131A24] dark:text-[#E9EDF3]">MWTRACK</span>
              <div className="text-[9px] font-medium uppercase tracking-widest text-[#1F4E9C] dark:text-[#7BA9EE] mt-0.5">Studio</div>
            </div>
          )}
        </div>
      </div>

      <nav className="flex-1 px-3.5 space-y-1 overflow-y-auto overflow-x-hidden">
        {items
          .filter((item) => !item.ownerAdminOnly || isOwnerOrAdmin)
          .filter((item) => !item.ownerOnly || user?.role === 'OWNER')
          .filter((item) => !item.requiredPermission || hasAnyPermission(user, item.requiredPermission))
          .map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const link = (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-sm transition-colors ${collapsed ? 'justify-center px-0' : ''} ${
                  active
                    ? 'bg-[#1F4E9C]/10 text-[#1F4E9C] font-medium dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]'
                    : 'text-[#5F6B7A] hover:bg-[#DCE1E8]/60 dark:text-[#92A0AF] dark:hover:bg-white/5'
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {!collapsed && item.label}
              </Link>
            );
            if (!collapsed) return link;
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger render={link} />
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
      </nav>

      <div className="p-3.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl hover:bg-[#DCE1E8]/60 dark:hover:bg-white/5 ${collapsed ? 'justify-center px-0' : ''}`}
          >
            <div className="w-8 h-8 rounded-full bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/10 flex items-center justify-center text-[#1F4E9C] dark:text-[#7BA9EE] font-medium text-sm shrink-0">
              {user?.firstName?.charAt(0)}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-medium truncate text-[#131A24] dark:text-[#E9EDF3]">{user?.firstName}</div>
                  <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] truncate">{user?.role}</div>
                </div>
                <ChevronDown className="w-4 h-4 text-[#5F6B7A] dark:text-[#92A0AF]" />
              </>
            )}
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
