'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../ui';

interface Invoice {
  id: string;
  plan: string;
  amount: string;
  status: string;
  txHash: string | null;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Супер-админ',
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  BUYER: 'Байер',
  OPERATOR: 'Оператор',
  OPERATOR_ADMIN: 'Оператор-админ',
};

// Studio-версия личных настроек аккаунта (запрос пользователя 2026-07-30: "добей остальные
// оставшиеся страницы") — логика 1:1 с классической (apps/web/.../(dashboard)/settings/page.tsx).
// Не путать с настройками ПРОЕКТА (dashboard/studio/projects/[id]/settings) — это отдельная,
// личная страница пользователя (профиль/выход, история платежей компании).
export default function StudioAccountSettingsPage() {
  const { user, logout } = useAuthStore();
  const [tab, setTab] = useState<'profile' | 'payments'>('profile');

  const { data: invoices } = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: async () => (await api.get<Invoice[]>('/billing/invoices')).data,
  });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Настройки</h1>

      <div className="inline-flex rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-1 gap-0.5">
        <button
          type="button"
          onClick={() => setTab('profile')}
          className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
            tab === 'profile' ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]' : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
          }`}
        >
          Профиль
        </button>
        <button
          type="button"
          onClick={() => setTab('payments')}
          className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
            tab === 'payments' ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]' : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
          }`}
        >
          История платежей
        </button>
      </div>

      {tab === 'profile' && (
        <div className={`${STUDIO_CARD} p-5 space-y-3`}>
          <h2 className="text-base font-semibold text-[#131A24] dark:text-[#E9EDF3]">Профиль</h2>
          <Field label="Имя" value={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()} />
          <Field label="Email" value={user?.email ?? ''} />
          <Field label="Роль" value={<StudioPill hue="slate">{ROLE_LABELS[user?.role ?? ''] || user?.role}</StudioPill>} />
          <Field label="Компания" value={user?.company?.name ?? ''} />
          <StudioLinkButton size="sm" onClick={logout}>
            Выйти из аккаунта
          </StudioLinkButton>
        </div>
      )}

      {tab === 'payments' && (
        <div className={`${STUDIO_CARD} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                <th className="px-5 py-3 font-medium">Дата</th>
                <th className="px-5 py-3 font-medium">План</th>
                <th className="px-5 py-3 font-medium">Сумма</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
              {invoices?.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-5 py-3 text-[#131A24] dark:text-[#E9EDF3]">{format(new Date(invoice.createdAt), 'd MMM yyyy HH:mm')}</td>
                  <td className="px-5 py-3 text-[#131A24] dark:text-[#E9EDF3]">{invoice.plan}</td>
                  <td className="px-5 py-3 font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{invoice.amount} USDT</td>
                  <td className="px-5 py-3">
                    <StudioPill hue={invoice.status === 'PAID' ? 'sage' : 'slate'}>{invoice.status}</StudioPill>
                  </td>
                  <td className="px-5 py-3 text-xs text-[#5F6B7A] dark:text-[#92A0AF]">{invoice.txHash ? `${invoice.txHash.slice(0, 10)}...` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5 border-b border-[#DCE1E8] dark:border-white/10 last:border-0">
      <span className="text-[#5F6B7A] dark:text-[#92A0AF]">{label}</span>
      <span className="text-[#131A24] dark:text-[#E9EDF3]">{value}</span>
    </div>
  );
}
