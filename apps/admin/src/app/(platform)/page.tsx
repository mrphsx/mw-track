'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Building2, Users, FolderOpen, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatsCard } from '@/components/shared/stats-card';

const PLANS = ['TRIAL', 'STARTER', 'GROWTH', 'SCALE', 'ENTERPRISE'] as const;
type Plan = (typeof PLANS)[number];

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
  balance: string;
  planExpiresAt: string | null;
  currentProjects: number;
  maxProjects: number;
  currentClients: number;
  maxClients: number;
  pushesThisMonth: number;
  maxPushesPerMonth: number;
  createdAt: string;
}

interface Stats {
  totalCompanies: number;
  expiredCompanies: number;
  byPlan: { plan: Plan; count: number }[];
  totalProjects: number;
  totalClients: number;
}

// Компании — главная страница платформенной админки (Фаза 4.3A, перенос функционала из
// бывшей embedded /admin-страницы в apps/web, тот же бэкенд без изменений). Drill-down по
// конкретной компании (переход по клику на строку) — Фаза 4.3B, ещё не построена.
export default function CompaniesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CompanyRow | null>(null);

  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => (await api.get<Stats>('/admin/stats')).data,
  });

  const { data: companies } = useQuery({
    queryKey: ['admin-companies', search],
    queryFn: async () => (await api.get<{ items: CompanyRow[]; total: number }>('/admin/companies', { params: { search: search || undefined } })).data,
  });

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Компании</h1>
        <p className="mt-1 text-sm text-gray-500">Все компании платформы — подписки, использование, лимиты</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard label="Всего компаний" value={stats?.totalCompanies ?? '—'} icon={Building2} />
        <StatsCard label="Просрочено" value={stats?.expiredCompanies ?? '—'} icon={AlertTriangle} />
        <StatsCard label="Проектов всего" value={stats?.totalProjects ?? '—'} icon={FolderOpen} />
        <StatsCard label="Клиентов всего" value={stats?.totalClients ?? '—'} icon={Users} />
      </div>

      {stats && stats.byPlan.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {stats.byPlan.map((p) => (
            <Badge key={p.plan} variant="outline">
              {p.plan}: {p.count}
            </Badge>
          ))}
        </div>
      )}

      <Input placeholder="Поиск по названию или slug..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Компания</TableHead>
                <TableHead>План</TableHead>
                <TableHead>Истекает</TableHead>
                <TableHead>Баланс</TableHead>
                <TableHead>Проекты</TableHead>
                <TableHead>Клиенты</TableHead>
                <TableHead>Пуши/мес</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies?.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/companies/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div className="text-xs text-gray-400">{c.slug}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{c.plan}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {c.planExpiresAt ? format(new Date(c.planExpiresAt), 'd MMM yyyy', { locale: ru }) : '—'}
                  </TableCell>
                  <TableCell className="text-xs">${Number(c.balance).toFixed(2)}</TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {c.currentProjects}/{c.maxProjects}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {c.currentClients}/{c.maxClients}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {c.pushesThisMonth}/{c.maxPushesPerMonth}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                      Изменить подписку
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {companies && companies.items.length === 0 && <p className="p-4 text-sm text-gray-400">Ничего не найдено</p>}
        </CardContent>
      </Card>

      {editing && (
        <SubscriptionDialog
          company={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['admin-companies'] });
            queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function SubscriptionDialog({ company, onClose, onSaved }: { company: CompanyRow; onClose: () => void; onSaved: () => void }) {
  const [plan, setPlan] = useState<Plan>(company.plan);
  const [expiresAt, setExpiresAt] = useState(company.planExpiresAt ? company.planExpiresAt.slice(0, 10) : '');

  const mutation = useMutation({
    mutationFn: async () =>
      api.patch(`/admin/companies/${company.id}/subscription`, {
        plan,
        planExpiresAt: expiresAt ? expiresAt : null,
      }),
    onSuccess: onSaved,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Подписка «{company.name}»</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500">План</label>
            <Select value={plan} onValueChange={(v) => setPlan(v as Plan)}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue>{plan}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PLANS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Дата истечения (пусто — не продлевается автоматически)</label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1 block w-full rounded-md border px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? 'Сохраняем...' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
