'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { Skeleton } from '@/components/ui/skeleton';
import { MarketingHome } from '@/components/marketing/marketing-home';

// Общий гейт для дизайна Studio — раньше owner-only (галерея прототипов, запрос 2026-07-28:
// "давай следующий дизайн, этот сохрани, пусть будет как список"; остальные варианты Control
// Room/Brutal/Ledger удалены 2026-07-30). Ограничение по роли снято 2026-07-30 ("пора выносить
// новый дизайн как основной... у всех показывался новый дизайн studio") — Studio теперь основной
// дизайн для ЛЮБОЙ роли, не только владельца, здесь остаётся только обычная проверка авторизации
// (как у классического (dashboard)/layout.tsx). Видимость отдельных пунктов навигации
// (Команда — только Owner/Admin, остальные — по granular-правам) по-прежнему на уровне
// StudioSidebar/самих страниц — это не менялось, тот же принцип, что и у классического Sidebar.
export default function DashboardOwnerGateLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { accessToken, hydrated } = useAuthStore();
  // Публичная домашняя страница (запрос пользователя 2026-08-04) — неавторизованный посетитель
  // корня видит мини-презентацию с кнопками входа/регистрации вместо немедленного редиректа на
  // /login; любой другой путь внутри Studio по-прежнему требует авторизации как раньше.
  const isPublicRoot = pathname === '/';

  useEffect(() => {
    if (hydrated && !accessToken && !isPublicRoot) router.replace('/login');
  }, [hydrated, accessToken, isPublicRoot, router]);

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Skeleton className="w-32 h-8" />
      </div>
    );
  }

  if (!accessToken) {
    if (isPublicRoot) return <MarketingHome />;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Skeleton className="w-32 h-8" />
      </div>
    );
  }

  return <>{children}</>;
}
