'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FolderOpen, Globe, CreditCard, Settings, ChevronDown, Zap, LogOut } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Лендинги/Команда — отдельные модули без готового фронтенда (управления командой/компанией
// нет вообще ни в одном backend-модуле) — пункты меню на них не добавлены, чтобы не вести
// на несуществующие страницы. Домены — Фаза 2.2, готово с 2026-06-28.
const navItems = [
  { href: '/', label: 'Обзор', icon: LayoutDashboard },
  { href: '/projects', label: 'Проекты', icon: FolderOpen },
  { href: '/domains', label: 'Домены', icon: Globe },
  { href: '/billing', label: 'Подписка', icon: CreditCard },
  { href: '/settings', label: 'Настройки', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  return (
    <aside className="w-60 border-r bg-white flex flex-col h-screen shrink-0">
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg">TrafficCRM</span>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t">
        <DropdownMenu>
          <DropdownMenuTrigger className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-medium text-sm">
              {user?.firstName?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-medium truncate">{user?.firstName}</div>
              <div className="text-xs text-gray-400 truncate">{user?.role}</div>
            </div>
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={logout} className="text-red-600">
              <LogOut className="w-4 h-4 mr-2" />
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
