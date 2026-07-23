'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { Sidebar } from '@/components/layout/sidebar';
import { Skeleton } from '@/components/ui/skeleton';

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { accessToken, user, hydrated } = useAuthStore();

  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken || user?.role !== 'SUPER_ADMIN') router.replace('/login');
  }, [hydrated, accessToken, user, router]);

  if (!hydrated || !accessToken || user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <Skeleton className="h-8 w-32" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
