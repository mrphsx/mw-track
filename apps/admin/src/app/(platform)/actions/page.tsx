'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ActionLogRow {
  id: string;
  action: string;
  previousValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  createdAt: string;
  company: { name: string };
  admin: { firstName: string; lastName: string | null; email: string };
}

interface CompanyOption {
  id: string;
  name: string;
}

// action — обычная строка на бэкенде (не enum), но на практике пишется только этими значениями
// (AdminService/AdminCompanyService) — человеко-читаемая подпись вместо голого SNAKE_CASE.
const ACTION_LABEL: Record<string, string> = {
  SUBSCRIPTION_CHANGE: 'Смена подписки',
  BALANCE_TOPUP: 'Пополнение баланса',
  RESTRICTIONS_CHANGE: 'Смена ограничений',
  DOMAIN_FORCE_DELETE: 'Принудительное удаление домена',
  COMPANY_VIEWED: 'Просмотр компании',
};

// Пагинация + фильтр по компании — тот же фикс, что и на странице "Ошибки" (аудит панели
// администратора 2026-07-30).
export default function ActionsPage() {
  const [page, setPage] = useState(1);
  const [companyId, setCompanyId] = useState<string>('all');

  const { data: companies } = useQuery({
    queryKey: ['admin-companies-lite'],
    queryFn: async () => (await api.get<{ items: CompanyOption[] }>('/admin/companies', { params: { limit: 200 } })).data.items,
  });

  const { data } = useQuery({
    queryKey: ['admin-actions', page, companyId],
    queryFn: async () =>
      (
        await api.get<{ items: ActionLogRow[]; total: number; page: number; totalPages: number }>('/admin/actions', {
          params: { page, limit: 50, companyId: companyId === 'all' ? undefined : companyId },
        })
      ).data,
  });

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Действия админов</h1>
          <p className="mt-1 text-sm text-gray-500">
            Аудит действий супер-админа — смена подписок, начисления, ограничения, просмотры компаний{data && ` — всего ${data.total}`}
          </p>
        </div>
        <Select value={companyId} onValueChange={(v) => { if (v) { setCompanyId(v); setPage(1); } }}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Все компании" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все компании</SelectItem>
            {companies?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Время</TableHead>
                <TableHead>Админ</TableHead>
                <TableHead>Компания</TableHead>
                <TableHead>Действие</TableHead>
                <TableHead>Было</TableHead>
                <TableHead>Стало</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-xs text-gray-500">{format(new Date(a.createdAt), 'd MMM HH:mm', { locale: ru })}</TableCell>
                  <TableCell className="text-xs">
                    {a.admin.firstName} {a.admin.lastName ?? ''}
                  </TableCell>
                  <TableCell className="text-xs">{a.company.name}</TableCell>
                  <TableCell className="text-xs">{ACTION_LABEL[a.action] ?? a.action}</TableCell>
                  <TableCell className="text-xs text-gray-500 max-w-[220px] truncate">{JSON.stringify(a.previousValue)}</TableCell>
                  <TableCell className="text-xs text-gray-500 max-w-[220px] truncate">{JSON.stringify(a.newValue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data && data.items.length === 0 && <p className="p-4 text-sm text-gray-400">Действий не зафиксировано</p>}
        </CardContent>
      </Card>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Назад
          </Button>
          <span className="text-sm text-gray-500">
            Страница {data.page} из {data.totalPages} ({data.total} всего)
          </span>
          <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Вперёд
          </Button>
        </div>
      )}
    </div>
  );
}
