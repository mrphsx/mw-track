'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAxiosError } from 'axios';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Клиентская проверка роли после логина — это UX-уровень, НЕ настоящая граница безопасности
// (та — @Roles(SUPER_ADMIN) на бэкенде, все /admin/* роуты). Любой другой аккаунт технически
// МОЖЕТ залогиниться (тот же POST /auth/login, что и у основной CRM), но сразу разлогинивается
// с понятным сообщением вместо попытки открыть пустую панель, которая всё равно получит 403 на
// каждый запрос.
export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, logout } = useAuthStore();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      const role = useAuthStore.getState().user?.role;
      if (role !== 'SUPER_ADMIN') {
        logout();
        setError('Доступ только для супер-админов платформы');
        return;
      }
      router.push('/');
    } catch (err) {
      setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow">
      <div className="mb-6 text-center">
        <div className="mb-1 text-3xl font-bold text-gray-900">MWTRACK PLATFORM</div>
        <p className="text-sm text-gray-500">Доступ только для супер-админов</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Пароль</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Входим...' : 'Войти'}
        </Button>
      </form>
    </div>
  );
}
