'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PaymentModal } from '@/components/billing/payment-modal';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../ui';

interface PlanConfig {
  priceUsdt: number;
  durationDays: number;
  maxProjects: number;
  maxClients: number;
  maxPushesPerMonth: number;
}

interface CompanyUsage {
  plan: string;
  planExpiresAt: string | null;
  balance: string;
  maxProjects: number;
  currentProjects: number;
  maxClients: number;
  currentClients: number;
  maxPushesPerMonth: number;
  pushesThisMonth: number;
}

interface Invoice {
  id: string;
  amount: string;
  network: string | null;
  status: string;
  txHash: string | null;
  createdAt: string;
}

type PaymentNetwork = 'TRC20' | 'ERC20' | 'BEP20';

const NETWORK_LABEL: Record<PaymentNetwork, string> = {
  TRC20: 'USDT TRC-20 (TRON)',
  ERC20: 'USDT ERC-20 (Ethereum)',
  BEP20: 'USDT BEP-20 (BNB Chain)',
};

interface BalanceTransaction {
  id: string;
  type: 'TOPUP' | 'SUBSCRIPTION_CHARGE' | 'DOWNGRADE' | 'ADMIN_CREDIT';
  amount: string;
  balanceAfter: string;
  plan: string | null;
  createdAt: string;
}

const PURCHASABLE: Array<'STARTER' | 'GROWTH' | 'SCALE'> = ['STARTER', 'GROWTH', 'SCALE'];
const TOPUP_PRESETS = [50, 100, 200];

const TRANSACTION_LABEL: Record<BalanceTransaction['type'], string> = {
  TOPUP: 'Пополнение',
  SUBSCRIPTION_CHARGE: 'Списание за подписку',
  DOWNGRADE: 'Сброс до TRIAL (не хватило баланса)',
  ADMIN_CREDIT: 'Начисление администратором',
};

// Studio-версия страницы подписки (запрос пользователя 2026-07-30: "готовить все остальные
// страницы") — логика 1:1 с классической (apps/web/.../(dashboard)/billing/page.tsx). PaymentModal
// переиспользован без изменений — финансовый модал с криптоплатежом/QR, тот же принцип, что и у
// остальных сложных диалогов в Studio (менять визуально не стоит риска на денежном потоке).
export default function StudioBillingPage() {
  const queryClient = useQueryClient();
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('100');
  const [topUpNetwork, setTopUpNetwork] = useState<PaymentNetwork>('TRC20');
  const [planError, setPlanError] = useState('');

  const { data: plans } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: async () => (await api.get<Record<string, PlanConfig>>('/billing/plans')).data,
  });

  const { data: usage } = useQuery({
    queryKey: ['billing', 'current'],
    queryFn: async () => (await api.get<CompanyUsage>('/billing/current')).data,
  });

  const { data: invoices } = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: async () => (await api.get<Invoice[]>('/billing/invoices')).data,
  });

  const { data: transactions } = useQuery({
    queryKey: ['billing', 'transactions'],
    queryFn: async () => (await api.get<BalanceTransaction[]>('/billing/transactions')).data,
  });

  const createTopUp = useMutation({
    mutationFn: async ({ amount, network }: { amount: number; network: PaymentNetwork }) =>
      (await api.post('/billing/topup', { amount, network })).data as Invoice,
    onSuccess: (invoice) => {
      setActiveInvoiceId(invoice.id);
      queryClient.invalidateQueries({ queryKey: ['billing', 'invoices'] });
    },
  });

  const selectPlan = useMutation({
    mutationFn: async (plan: string) => (await api.post('/billing/select-plan', { plan })).data,
    onSuccess: () => {
      setPlanError('');
      queryClient.invalidateQueries({ queryKey: ['billing', 'current'] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'transactions'] });
    },
    onError: (err) => setPlanError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сменить тариф'),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Подписка</h1>

      <div className={`${STUDIO_CARD} p-5 space-y-4`}>
        <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Баланс</h2>
        <div className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] font-mono tabular-nums">${usage?.balance ?? '0.00'}</div>
        <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
          Тариф продлевается автоматически списанием с баланса раз в период. Не хватит средств на момент продления —
          тариф будет сброшен до TRIAL.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {TOPUP_PRESETS.map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => setTopUpAmount(String(amount))}
              className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                topUpAmount === String(amount)
                  ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                  : 'bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
              }`}
            >
              ${amount}
            </button>
          ))}
          <Input type="number" min={10} value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} className="w-28 rounded-lg" />
          <Select value={topUpNetwork} onValueChange={(v) => setTopUpNetwork(v as PaymentNetwork)}>
            <SelectTrigger className="w-44">
              <SelectValue>{(v: PaymentNetwork) => NETWORK_LABEL[v]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TRC20">{NETWORK_LABEL.TRC20}</SelectItem>
              <SelectItem value="ERC20">{NETWORK_LABEL.ERC20}</SelectItem>
              <SelectItem value="BEP20">{NETWORK_LABEL.BEP20}</SelectItem>
            </SelectContent>
          </Select>
          <StudioLinkButton
            variant="primary"
            disabled={!topUpAmount || Number(topUpAmount) < 10 || createTopUp.isPending}
            onClick={() => createTopUp.mutate({ amount: Number(topUpAmount), network: topUpNetwork })}
          >
            {createTopUp.isPending ? 'Создаём счёт...' : 'Пополнить'}
          </StudioLinkButton>
          <StudioLinkButton disabled>Heleket (скоро)</StudioLinkButton>
        </div>
      </div>

      {usage && (
        <div className={`${STUDIO_CARD} p-5 space-y-4`}>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Текущий план:</h2>
            <StudioPill hue="amber">{usage.plan}</StudioPill>
            {usage.planExpiresAt && (
              <span className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">следующее списание {format(new Date(usage.planExpiresAt), 'd MMM yyyy')}</span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <UsageBar label="Проекты" current={usage.currentProjects} max={usage.maxProjects} />
            <UsageBar label="Клиенты" current={usage.currentClients} max={usage.maxClients} />
            <UsageBar label="Рассылок в месяц" current={usage.pushesThisMonth} max={usage.maxPushesPerMonth} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {PURCHASABLE.map((plan) => {
          const config = plans?.[plan];
          const isCurrent = usage?.plan === plan;
          return (
            <div key={plan} className={`${STUDIO_CARD} p-5 space-y-3 ${isCurrent ? 'ring-2 ring-[#1F4E9C] dark:ring-[#7BA9EE]' : ''}`}>
              <h3 className="text-base font-semibold text-[#131A24] dark:text-[#E9EDF3]">{plan}</h3>
              <div className="text-2xl font-bold text-[#131A24] dark:text-[#E9EDF3]">${config?.priceUsdt}/мес</div>
              <ul className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] space-y-1">
                <li>{config?.maxProjects} проектов</li>
                <li>{config?.maxClients.toLocaleString()} клиентов</li>
                <li>{config?.maxPushesPerMonth} рассылок/мес</li>
              </ul>
              <StudioLinkButton
                variant={isCurrent ? 'secondary' : 'primary'}
                disabled={selectPlan.isPending}
                onClick={() => selectPlan.mutate(plan)}
              >
                {isCurrent ? 'Продлить сейчас' : 'Выбрать'}
              </StudioLinkButton>
            </div>
          );
        })}
      </div>
      {planError && <p className="text-sm text-red-500">{planError}</p>}

      <div>
        <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-3">Пополнения</h2>
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
              {invoices?.map((invoice) => (
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
      </div>

      <div>
        <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-3">История операций</h2>
        <div className={`${STUDIO_CARD} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                <th className="px-5 py-3 font-medium">Дата</th>
                <th className="px-5 py-3 font-medium">Операция</th>
                <th className="px-5 py-3 font-medium">Сумма</th>
                <th className="px-5 py-3 font-medium">Остаток</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
              {transactions?.map((tx) => (
                <tr key={tx.id}>
                  <td className="px-5 py-3 text-[#131A24] dark:text-[#E9EDF3]">{format(new Date(tx.createdAt), 'd MMM yyyy HH:mm')}</td>
                  <td className="px-5 py-3 text-[#131A24] dark:text-[#E9EDF3]">
                    {TRANSACTION_LABEL[tx.type]}
                    {tx.type === 'SUBSCRIPTION_CHARGE' && tx.plan ? ` (${tx.plan})` : ''}
                  </td>
                  <td className={`px-5 py-3 font-mono tabular-nums ${Number(tx.amount) < 0 ? 'text-red-600 dark:text-red-400' : 'text-[#1F7A6C] dark:text-[#6FCBBA]'}`}>
                    {Number(tx.amount) > 0 ? '+' : ''}
                    {tx.amount} USDT
                  </td>
                  <td className="px-5 py-3 font-mono tabular-nums text-[#5F6B7A] dark:text-[#92A0AF]">${tx.balanceAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PaymentModal invoiceId={activeInvoiceId} onClose={() => setActiveInvoiceId(null)} />
    </div>
  );
}

function UsageBar({ label, current, max }: { label: string; current: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-[#5F6B7A] dark:text-[#92A0AF]">{label}</span>
        <span className="text-[#131A24] dark:text-[#E9EDF3] font-mono tabular-nums">
          {current} / {max}
        </span>
      </div>
      <Progress value={pct} />
    </div>
  );
}
