'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAxiosError } from 'axios';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function RegisterPage() {
  const [companyName, setCompanyName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const register = useAuthStore((s) => s.register);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await register({ companyName, firstName, email, password });
      router.push('/');
    } catch (err) {
      setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <span className="lg:hidden text-lg font-bold tracking-tight text-[#131A24] dark:text-white">
        MW<span className="text-[#1F4E9C] dark:text-[#7BA9EE]">TRACK</span>
      </span>
      <h1 className="mt-6 lg:mt-0 text-2xl font-bold tracking-tight text-[#131A24] dark:text-white">Создайте аккаунт</h1>
      <p className="mt-1.5 text-sm text-[#5F6B7A] dark:text-[#92A0AF]">14 дней бесплатно, банковская карта не нужна</p>
      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="companyName">Название компании</Label>
          <Input id="companyName" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="firstName">Имя</Label>
          <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Пароль</Label>
          <Input id="password" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" disabled={loading} className="w-full bg-[#1F4E9C] hover:bg-[#1F4E9C]/90 dark:bg-[#7BA9EE] dark:text-[#0F1620]">
          {loading ? 'Создаём аккаунт...' : 'Зарегистрироваться'}
        </Button>
        <p className="text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
          Уже есть аккаунт?{' '}
          <Link href="/login" className="text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline">
            Войти
          </Link>
        </p>
      </form>
    </div>
  );
}
