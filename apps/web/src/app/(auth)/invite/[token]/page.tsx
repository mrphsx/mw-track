'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Администратор',
  BUYER: 'Байер',
  OPERATOR: 'Оператор',
  OPERATOR_ADMIN: 'Оператор-админ',
};

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const acceptInvite = useAuthStore((s) => s.acceptInvite);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { data: invite, isLoading, isError } = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: async () => (await api.get<{ companyName: string; role: string }>(`/team-invites/${token}/preview`)).data,
    retry: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await acceptInvite(token, { email, password, firstName, lastName: lastName || undefined });
      router.push('/');
    } catch (err) {
      setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось принять приглашение');
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Загрузка...</p>;
  }

  if (isError || !invite) {
    return (
      <div className="text-center">
        <span className="text-lg font-bold tracking-tight text-[#131A24] dark:text-white">
          MW<span className="text-[#1F4E9C] dark:text-[#7BA9EE]">TRACK</span>
        </span>
        <p className="mt-4 text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
          Ссылка-приглашение недействительна, уже использована или истекла. Попросите отправителя
          выслать новую.
        </p>
      </div>
    );
  }

  return (
    <div>
      <span className="lg:hidden text-lg font-bold tracking-tight text-[#131A24] dark:text-white">
        MW<span className="text-[#1F4E9C] dark:text-[#7BA9EE]">TRACK</span>
      </span>
      <h1 className="mt-6 lg:mt-0 text-2xl font-bold tracking-tight text-[#131A24] dark:text-white">Присоединиться к команде</h1>
      <p className="mt-1.5 text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
        Вас пригласили в «{invite.companyName}» с ролью {ROLE_LABELS[invite.role] || invite.role}
      </p>
      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="firstName">Имя</Label>
          <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lastName">Фамилия</Label>
          <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
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
          {loading ? 'Присоединяемся...' : 'Присоединиться к команде'}
        </Button>
      </form>
    </div>
  );
}
