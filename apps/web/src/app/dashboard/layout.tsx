'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { Skeleton } from '@/components/ui/skeleton';

// Общий owner-only гейт для дизайна Studio (изначально написан как гейт для всей галереи
// прототипов, запрос 2026-07-28: "давай следующий дизайн, этот сохрани, пусть будет как
// список" — галерея и остальные варианты (Control Room/Brutal/Ledger) удалены 2026-07-30 по
// запросу пользователя, Studio остался единственным и живёт под /dashboard/studio/*, этот
// гейт по-прежнему нужен именно ему). Сайдбар/шапка самого Studio — в его собственном layout
// НИЖЕ этого, сюда он не заходит, здесь только доступ.
export default function DashboardOwnerGateLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { accessToken, hydrated, user } = useAuthStore();
  const isOwner = user?.role === 'OWNER' || user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken) {
      router.replace('/login');
      return;
    }
    if (user && !isOwner) router.replace('/');
  }, [hydrated, accessToken, user, isOwner, router]);

  if (!hydrated || !accessToken || !isOwner) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Skeleton className="w-32 h-8" />
      </div>
    );
  }

  return <>{children}</>;
}
