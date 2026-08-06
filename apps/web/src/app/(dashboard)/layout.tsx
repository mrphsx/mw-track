'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { Skeleton } from '@/components/ui/skeleton';
import { MarketingHome } from '@/components/marketing/marketing-home';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { accessToken, hydrated } = useAuthStore();
  // Та же публичная домашняя страница, что и в Studio-гейте apps/web/src/app/dashboard/layout.tsx
  // (запрос пользователя 2026-08-04) — на случай прямого захода на old.mw-track.com/.
  const isPublicRoot = pathname === '/';

  useEffect(() => {
    if (hydrated && !accessToken && !isPublicRoot) router.replace('/login');
  }, [hydrated, accessToken, isPublicRoot, router]);

  // Пока persist-стор не гидратировался (читает localStorage только после монтирования) —
  // нельзя ни показывать дашборд, ни редиректить: ещё не известно, авторизован ли пользователь.
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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
