'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAxiosError } from 'axios';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const login = useAuthStore((s) => s.login);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      // "/" на основном домене теперь резолвит Studio (см. middleware.ts) — запрос пользователя
      // 2026-07-30: "путь / должен вести сразу на новый дизайн". Классика живёт на
      // old.mw-track.com, отдельным доменом, не путём внутри этого же приложения.
      router.push('/');
    } catch (err) {
      setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <span className="lg:hidden text-lg font-bold tracking-tight text-[#131A24] dark:text-white">
        MW<span className="text-[#1F4E9C] dark:text-[#7BA9EE]">TRACK</span>
      </span>
      <h1 className="mt-6 lg:mt-0 text-2xl font-bold tracking-tight text-[#131A24] dark:text-white">С возвращением</h1>
      <p className="mt-1.5 text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Войдите в свой аккаунт</p>
      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Пароль</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" disabled={loading} className="w-full bg-[#1F4E9C] hover:bg-[#1F4E9C]/90 dark:bg-[#7BA9EE] dark:text-[#0F1620]">
          {loading ? 'Входим...' : 'Войти'}
        </Button>
        <p className="text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
          Нет аккаунта?{' '}
          <Link href="/register" className="text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline">
            Зарегистрироваться
          </Link>
        </p>
      </form>
    </div>
  );
}
