'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ErrorLogRow {
  id: string;
  message: string;
  stack: string | null;
  route: string | null;
  statusCode: number | null;
  createdAt: string;
  company: { name: string } | null;
}

export default function ErrorsPage() {
  const { data } = useQuery({
    queryKey: ['admin-errors'],
    queryFn: async () => (await api.get<{ items: ErrorLogRow[]; total: number }>('/admin/errors')).data,
  });

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ошибки</h1>
        <p className="mt-1 text-sm text-gray-500">Реальные 500-е по всей платформе, автоматически (30 дней хранения)</p>
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
