'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PaymentModal } from '@/components/billing/payment-modal';

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

// ADMIN_CREDIT — ручное начисление супер-админом через отдельную панель (Фаза 4.3C,
// запрос пользователя 2026-07-19). Намеренно видно клиенту в его же истории операций
// (прозрачность), не скрыто — просто с понятной меткой, не как настоящий крипто-платёж.
const TRANSACTION_LABEL: Record<BalanceTransaction['type'], string> = {
  TOPUP: 'Пополнение',
  SUBSCRIPTION_CHARGE: 'Списание за подписку',
  DOWNGRADE: 'Сброс до TRIAL (не хватило баланса)',
  ADMIN_CREDIT: 'Начисление администратором',
};

export default function BillingPage() {
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
      <h1 className="text-2xl font-bold">Подписка</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Баланс</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-3xl font-bold">${usage?.balance ?? '0.00'}</div>
          <p className="text-xs text-muted-foreground">
            Тариф продлевается автоматически списанием с баланса раз в период. Не хватит средств на момент продления —
            тариф будет сброшен до TRIAL.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {TOPUP_PRESETS.map((amount) => (
              <Button key={amount} variant={topUpAmount === String(amount) ? 'default' : 'outline'} size="sm" onClick={() => setTopUpAmount(String(amount))}>
                ${amount}
              </Button>
            ))}
            <Input
              type="number"
              min={10}
              value={topUpAmount}
              onChange={(e) => setTopUpAmount(e.target.value)}
              className="w-28"
            />
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
            <Button
              disabled={!topUpAmount || Number(topUpAmount) < 10 || createTopUp.isPending}
              onClick={() => createTopUp.mutate({ amount: Number(topUpAmount), network: topUpNetwork })}
            >
              {createTopUp.isPending ? 'Создаём счёт...' : 'Пополнить'}
            </Button>
            <Button variant="outline" disabled title="Оплата через Heleket (карты, ещё больше криптовалют) — готовится, скоро будет доступна">
              Heleket (скоро)
            </Button>
          </div>
        </CardContent>
      </Card>

      {usage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Текущий план: <Badge>{usage.plan}</Badge>
              {usage.planExpiresAt && (
                <span className="text-sm text-muted-foreground font-normal">
                  следующее списание {format(new Date(usage.planExpiresAt), 'd MMM yyyy')}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <UsageBar label="Проекты" current={usage.currentProjects} max={usage.maxProjects} />
            <UsageBar label="Клиенты" current={usage.currentClients} max={usage.maxClients} />
            <UsageBar label="Рассылок в месяц" current={usage.pushesThisMonth} max={usage.maxPushesPerMonth} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {PURCHASABLE.map((plan) => {
          const config = plans?.[plan];
          return (
            <Card key={plan} className={usage?.plan === plan ? 'border-blue-500' : ''}>
              <CardHeader>
                <CardTitle>{plan}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-2xl font-bold">${config?.priceUsdt}/мес</div>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>{config?.maxProjects} проектов</li>
                  <li>{config?.maxClients.toLocaleString()} клиентов</li>
                  <li>{config?.maxPushesPerMonth} рассылок/мес</li>
                </ul>
                <Button
                  className="w-full"
                  variant={usage?.plan === plan ? 'outline' : 'default'}
                  disabled={selectPlan.isPending}
                  onClick={() => selectPlan.mutate(plan)}
                >
                  {usage?.plan === plan ? 'Продлить сейчас' : 'Выбрать'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {planError && <p className="text-sm text-red-500">{planError}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Пополнения</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Сумма</TableHead>
                <TableHead>Сеть</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Tx</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices?.map((invoice) => (
                <TableRow
                  key={invoice.id}
                  className={invoice.status === 'PENDING' ? 'cursor-pointer' : ''}
                  onClick={() => invoice.status === 'PENDING' && setActiveInvoiceId(invoice.id)}
                >
                  <TableCell>{format(new Date(invoice.createdAt), 'd MMM yyyy HH:mm')}</TableCell>
                  <TableCell>{invoice.amount} USDT</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{invoice.network ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={invoice.status === 'PAID' ? 'default' : invoice.status === 'PENDING' ? 'outline' : 'secondary'}>
                      {invoice.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{invoice.txHash ? `${invoice.txHash.slice(0, 10)}...` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">История операций</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Операция</TableHead>
                <TableHead>Сумма</TableHead>
                <TableHead>Остаток</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions?.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell>{format(new Date(tx.createdAt), 'd MMM yyyy HH:mm')}</TableCell>
                  <TableCell>
                    {TRANSACTION_LABEL[tx.type]}
                    {tx.type === 'SUBSCRIPTION_CHARGE' && tx.plan ? ` (${tx.plan})` : ''}
                  </TableCell>
                  <TableCell className={Number(tx.amount) < 0 ? 'text-red-500' : 'text-green-600'}>
                    {Number(tx.amount) > 0 ? '+' : ''}
                    {tx.amount} USDT
                  </TableCell>
                  <TableCell className="text-muted-foreground">${tx.balanceAfter}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PaymentModal invoiceId={activeInvoiceId} onClose={() => setActiveInvoiceId(null)} />
    </div>
  );
}

function UsageBar({ label, current, max }: { label: string; current: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span>
          {current} / {max}
        </span>
      </div>
      <Progress value={pct} />
    </div>
  );
}
