'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
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
  ShieldAlert,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Zap,
  LogOut,
  Sun,
  Moon,
  Monitor,
  BarChart3,
  BookOpen,
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
}
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const THEME_OPTIONS = [
  { value: 'light', label: 'Светлая', icon: Sun },
  { value: 'dark', label: 'Тёмная', icon: Moon },
  { value: 'system', label: 'Системная', icon: Monitor },
] as const;

// Лендинги (общий список всех проектов) — 2026-07-02. Домены — Фаза 2.2, готово с 2026-06-28.
// Команда — Фаза 1, готово с 2026-07-04, пункт виден только Owner/Admin (см. фильтр ниже,
// управление командой — отдельное от гранулярных прав право, не входит в эту систему).
// Пересечение аудиторий — 2026-07-04, видимость сама ограничена доступными проектами на
// бэкенде (Buyer/Operator видят только свои), пункт меню поэтому не ограничен ролью.
// requiredPermission — гранулярные права (запрос пользователя 2026-07-17): скрывает пункт,
// если у пользователя нет соответствующего *_VIEW (elevated роли видят всегда, см.
// hasPermission).
// Календарь рассылок (общий по всем проектам) — 2026-07-19, тот же принцип видимости, что и
// у "Пересечение аудиторий": сама страница не ограничена ролью, доступные даты внутри
// ограничены на бэкенде (Buyer/Operator видят только свои назначенные проекты).
const navItems: NavItem[] = [
  { href: '/', label: 'Обзор', icon: LayoutDashboard },
  { href: '/projects', label: 'Проекты', icon: FolderOpen },
  {
    href: '/pushes-calendar',
    label: 'Рассылки',
    icon: Send,
    requiredPermission: 'PUSHES_VIEW' as const,
  },
  {
    href: '/stories',
    label: 'Истории',
    icon: Camera,
    requiredPermission: 'CHANNEL_VIEW' as const,
  },
  {
    href: '/landings',
    label: 'Лендинги',
    icon: LayoutTemplate,
    requiredPermission: 'LANDINGS_VIEW' as const,
  },
  { href: '/audience', label: 'Пересечение аудиторий', icon: Layers },
  { href: '/domains', label: 'Домены', icon: Globe, requiredPermission: 'DOMAINS_VIEW' as const },
  { href: '/team', label: 'Команда', icon: Users, ownerAdminOnly: true },
  { href: '/billing', label: 'Подписка', icon: CreditCard },
  { href: '/docs', label: 'Документация', icon: BookOpen },
  { href: '/settings', label: 'Настройки', icon: Settings },
];

// Жёсткий 2-пунктный сайдбар для Operator (запрос пользователя 2026-07-30: "нужно давать
// только одну страницу, страницу клиентов их проекта и свою страницу общей статистики") —
// полностью заменяет navItems, а не добавляется к нему; не завязан на requiredPermission/
// ownerAdminOnly, поэтому проходит через существующие фильтры ниже без изменений.
const OPERATOR_NAV_ITEMS: NavItem[] = [
  { href: '/my-clients', label: 'Клиенты', icon: Users },
  { href: '/my-stats', label: 'Моя статистика', icon: BarChart3 },
];

// Платформенная админка (Фаза 4.3, запрос пользователя 2026-07-19) переехала в полностью
// отдельное Next.js-приложение apps/admin — сознательно НЕ пункт в этом меню ("не будем её
// внедрять в меню текущей CRM системы... просто отдельная страница открывается при нажатии на
// кнопку"), только ссылка в выпадающем меню пользователя, видимая исключительно SUPER_ADMIN,
// открывается в новой вкладке (другой origin — свой логин, свой localStorage).
const ADMIN_PLATFORM_URL = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3002';

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar } = useUiStore();
  // OPERATOR_ADMIN тоже должен видеть "Команда" (запрос пользователя 2026-07-30: "имеет
  // возможность добавлять операторов и редактировать их разрешения") — управляет операторами
  // в своих проектах, не остальным, что видит Admin (это ограничивается на бэкенде, не здесь).
  const isOwnerOrAdmin =
    user?.role === 'OWNER' ||
    user?.role === 'ADMIN' ||
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'OPERATOR_ADMIN';
  const items = user?.role === 'OPERATOR' ? OPERATOR_NAV_ITEMS : navItems;
  const { theme, setTheme } = useTheme();
  // resolvedTheme/theme неопределены до маунта (next-themes читает localStorage на клиенте) —
  // без этой защиты иконка триггера мигала бы светлой при первом рендере тёмной темы. Тот же
  // mounted-гейт заодно защищает sidebarCollapsed от hydration mismatch (запрос пользователя
  // 2026-07-31: сворачивание сайдбара до иконок).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const ThemeIcon = mounted
    ? (THEME_OPTIONS.find((t) => t.value === theme)?.icon ?? Monitor)
    : Monitor;
  const collapsed = mounted && sidebarCollapsed;

  return (
    <aside className={`relative border-r bg-card flex flex-col h-screen shrink-0 transition-[width] duration-200 ${collapsed ? 'w-[68px]' : 'w-60'}`}>
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
        className="absolute -right-3 top-6 z-10 w-6 h-6 rounded-full bg-card border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
      >
        {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>

      <div className="p-4 border-b">
        <div className={`flex items-center gap-2 ${collapsed ? 'justify-center' : ''}`}>
          {/* Брендовый синий — не токен: --primary в этой теме нейтрально-серый (shadcn
              default), а не фирменный цвет, см. значения в globals.css. Единственный
              настоящий акцентный цвет в приложении сейчас — этот хардкод, оставляем как есть,
              просто добавляем тёмный вариант, где иначе терялась контрастность. */}
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-white" />
          </div>
          {!collapsed && <span className="font-bold text-lg">MWTRACK</span>}
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto overflow-x-hidden">
        {items
          .filter((item) => !item.ownerAdminOnly || isOwnerOrAdmin)
          .filter(
            // Нет конкретного projectId в контексте сайдбара — "есть ли право хотя бы на
            // одном доступном проекте" (запрос пользователя 2026-07-28, per-project редизайн).
            (item) => !item.requiredPermission || hasAnyPermission(user, item.requiredPermission),
          )
          .map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const link = (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${collapsed ? 'justify-center px-0' : ''} ${
                  active
                    ? 'bg-blue-50 text-blue-600 font-medium dark:bg-blue-950 dark:text-blue-400'
                    : 'text-muted-foreground hover:bg-muted'
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

      <div className="p-3 border-t">
        <DropdownMenu>
          <DropdownMenuTrigger className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted ${collapsed ? 'justify-center px-0' : ''}`}>
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-medium text-sm dark:bg-blue-950 dark:text-blue-400 shrink-0">
              {user?.firstName?.charAt(0)}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-medium truncate">{user?.firstName}</div>
                  <div className="text-xs text-muted-foreground truncate">{user?.role}</div>
                </div>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <div className="px-1.5 py-1 text-xs text-muted-foreground flex items-center gap-1.5">
              <ThemeIcon className="w-3.5 h-3.5" /> Тема
            </div>
            <DropdownMenuRadioGroup value={mounted ? theme : undefined} onValueChange={setTheme}>
              {THEME_OPTIONS.map((opt) => (
                <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                  <opt.icon className="w-4 h-4 mr-1.5" />
                  {opt.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            {user?.role === 'SUPER_ADMIN' && (
              <DropdownMenuItem
                render={
                  <a href={ADMIN_PLATFORM_URL} target="_blank" rel="noopener noreferrer">
                    <ShieldAlert className="w-4 h-4 mr-2" />
                    Платформа (админ)
                  </a>
                }
              />
            )}
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
