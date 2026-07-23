'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, AlertTriangle, History, ShieldAlert, LogOut } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';

const navItems = [
  { href: '/', label: 'Компании', icon: Building2 },
  { href: '/errors', label: 'Ошибки', icon: AlertTriangle },
  { href: '/actions', label: 'Действия админов', icon: History },
];

// Визуально тёмный сайдбар (в отличие от светлого apps/web) — намеренная различимость "это
// другая система" (запрос пользователя 2026-07-19: "со своим интерфейсом и другим сайдбаром").
export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col bg-gray-950 text-gray-300">
      <div className="border-b border-gray-800 p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600">
            <ShieldAlert className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-bold text-white">MWTRACK PLATFORM</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {navItems.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? 'bg-gray-800 font-medium text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-gray-800 p-3">
        <div className="mb-2 px-1 text-xs text-gray-500 truncate">{user?.email}</div>
        <button
          onClick={() => logout()}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-900 hover:text-gray-200"
        >
          <LogOut className="h-4 w-4" /> Выйти
        </button>
      </div>
    </aside>
  );
}
