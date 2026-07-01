'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { accessToken, hydrated } = useAuthStore();

  useEffect(() => {
    if (hydrated && accessToken) router.replace('/');
  }, [hydrated, accessToken, router]);

  return <div className="min-h-screen flex items-center justify-center bg-gray-50">{children}</div>;
}
