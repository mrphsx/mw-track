'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { accessToken, user, hydrated } = useAuthStore();

  // Проверка тоже на role, не только accessToken (найдено живой проверкой 2026-07-19) — без
  // неё логин НЕ-супер-админа гонялся с проверкой роли в login/page.tsx: этот эффект успевал
  // среагировать на свежий accessToken и увести на '/' ПЕРВЫМ, до того как login/page.tsx
  // успевала показать "Доступ только для супер-админов" и разлогинить — (platform)/layout.tsx
  // тут же отбивал обратно на /login, но по пути стирал состояние ошибки на форме. Сама
  // граница безопасности не пробивалась (пользователь никогда не видел данные), терялось
  // только сообщение.
  useEffect(() => {
    if (hydrated && accessToken && user?.role === 'SUPER_ADMIN') router.replace('/');
  }, [hydrated, accessToken, user, router]);

  return <div className="min-h-screen flex items-center justify-center bg-gray-950">{children}</div>;
}
