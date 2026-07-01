'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
  ADVERTISER: 'Рекламщик',
};

export default function SettingsPage() {
  const { user, logout } = useAuthStore();

  const { data: invoices } = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: async () => (await api.get<Invoice[]>('/billing/invoices')).data,
  });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Настройки</h1>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Профиль</TabsTrigger>
          <TabsTrigger value="payments">История платежей</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Профиль</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Имя" value={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()} />
              <Field label="Email" value={user?.email ?? ''} />
              <Field label="Роль" value={<Badge variant="outline">{ROLE_LABELS[user?.role ?? ''] || user?.role}</Badge>} />
              <Field label="Компания" value={user?.company?.name ?? ''} />
              <Button variant="outline" size="sm" onClick={logout}>
                Выйти из аккаунта
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>План</TableHead>
                    <TableHead>Сумма</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Tx</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices?.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>{format(new Date(invoice.createdAt), 'd MMM yyyy HH:mm')}</TableCell>
                      <TableCell>{invoice.plan}</TableCell>
                      <TableCell>{invoice.amount} USDT</TableCell>
                      <TableCell>
                        <Badge variant={invoice.status === 'PAID' ? 'default' : 'secondary'}>{invoice.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-400">
                        {invoice.txHash ? `${invoice.txHash.slice(0, 10)}...` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
      <span className="text-gray-500">{label}</span>
      <span>{value}</span>
    </div>
  );
}
