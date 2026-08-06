'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ErrorLogRow {
  id: string;
  message: string;
  stack: string | null;
  route: string | null;
  statusCode: number | null;
  createdAt: string;
  company: { name: string } | null;
}

interface CompanyOption {
  id: string;
  name: string;
}

// Пагинация + фильтр по компании (аудит панели администратора 2026-07-30: "133 ошибки в базе,
// а страница тихо показывала только первые 50 без единой возможности увидеть остальное") —
// бэкенд (AdminService.getErrors) уже поддерживал page/limit/companyId, фронт просто не
// передавал их вообще.
export default function ErrorsPage() {
  const [page, setPage] = useState(1);
  const [companyId, setCompanyId] = useState<string>('all');

  const { data: companies } = useQuery({
    queryKey: ['admin-companies-lite'],
    queryFn: async () => (await api.get<{ items: CompanyOption[] }>('/admin/companies', { params: { limit: 200 } })).data.items,
  });

  const { data } = useQuery({
    queryKey: ['admin-errors', page, companyId],
    queryFn: async () =>
      (
        await api.get<{ items: ErrorLogRow[]; total: number; page: number; totalPages: number }>('/admin/errors', {
          params: { page, limit: 50, companyId: companyId === 'all' ? undefined : companyId },
        })
      ).data,
  });

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Ошибки</h1>
          <p className="mt-1 text-sm text-gray-500">
            Реальные 500-е по всей платформе, автоматически (30 дней хранения){data && ` — всего ${data.total}`}
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
                <TableHead>Компания</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Код</TableHead>
                <TableHead>Сообщение</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((e) => (
                <ErrorRow key={e.id} row={e} />
              ))}
            </TableBody>
          </Table>
          {data && data.items.length === 0 && <p className="p-4 text-sm text-gray-400">Ошибок не зафиксировано</p>}
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

function ErrorRow({ row }: { row: ErrorLogRow }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setExpanded((v) => !v)}>
        <TableCell className="text-xs text-gray-500">{format(new Date(row.createdAt), 'd MMM HH:mm', { locale: ru })}</TableCell>
        <TableCell className="text-xs">{row.company?.name ?? '—'}</TableCell>
        <TableCell className="max-w-[220px] truncate text-xs">{row.route}</TableCell>
        <TableCell>
          <Badge variant="destructive">{row.statusCode}</Badge>
        </TableCell>
        <TableCell className="max-w-[320px] truncate text-xs">{row.message}</TableCell>
      </TableRow>
      {expanded && row.stack && (
        <TableRow>
          <TableCell colSpan={5} className="whitespace-pre-wrap bg-gray-50 text-[11px] text-gray-600">
            {row.stack}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
