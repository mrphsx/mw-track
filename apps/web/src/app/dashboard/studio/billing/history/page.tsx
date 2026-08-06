'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { PaymentModal } from '@/components/billing/payment-modal';
import { STUDIO_CARD, StudioPill } from '../../ui';

interface Invoice {
  id: string;
  amount: string;
  network: string | null;
  status: string;
  txHash: string | null;
  createdAt: string;
}

// Отдельная страница истории пополнений (запрос пользователя 2026-07-30: "историю пополнения
// добавь в отдельную страницу") — раньше таблица инвойсов жила прямо на странице подписки,
// теперь та страница короче, а полная история — здесь, по ссылке "История пополнений".
// PaymentModal переиспользован без изменений — клик по ещё не оплаченному (PENDING) инвойсу
// открывает тот же QR-модал, что и при создании нового пополнения.
export default function StudioBillingHistoryPage() {
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);

  const { data: invoices, isLoading } = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: async () => (await api.get<Invoice[]>('/billing/invoices')).data,
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/billing"
          className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Подписка
        </Link>
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">История пополнений</h1>
      </div>

      {isLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {!isLoading && invoices?.length === 0 && (
        <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>Пополнений пока не было.</div>
      )}

      {!!invoices?.length && (
        <div className={`${STUDIO_CARD} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                <th className="px-5 py-3 font-medium">Дата</th>
                <th className="px-5 py-3 font-medium">Сумма</th>
                <th className="px-5 py-3 font-medium">Сеть</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
              {invoices.map((invoice) => (
                <tr
                  key={invoice.id}
                  className={invoice.status === 'PENDING' ? 'cursor-pointer hover:bg-[#F3F5F8] dark:hover:bg-white/5' : ''}
                  onClick={() => invoice.status === 'PENDING' && setActiveInvoiceId(invoice.id)}
                >
                  <td className="px-5 py-3 text-[#131A24] dark:text-[#E9EDF3]">{format(new Date(invoice.createdAt), 'd MMM yyyy HH:mm')}</td>
                  <td className="px-5 py-3 font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{invoice.amount} USDT</td>
                  <td className="px-5 py-3 text-xs text-[#5F6B7A] dark:text-[#92A0AF]">{invoice.network ?? '—'}</td>
                  <td className="px-5 py-3">
                    <StudioPill hue={invoice.status === 'PAID' ? 'sage' : invoice.status === 'PENDING' ? 'amber' : 'slate'}>{invoice.status}</StudioPill>
                  </td>
                  <td className="px-5 py-3 text-xs text-[#5F6B7A] dark:text-[#92A0AF]">{invoice.txHash ? `${invoice.txHash.slice(0, 10)}...` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PaymentModal invoiceId={activeInvoiceId} onClose={() => setActiveInvoiceId(null)} />
    </div>
  );
}
