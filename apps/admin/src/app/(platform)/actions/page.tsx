'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ActionLogRow {
  id: string;
  action: string;
  previousValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  createdAt: string;
  company: { name: string };
  admin: { firstName: string; lastName: string | null; email: string };
}

export default function ActionsPage() {
  const { data } = useQuery({
    queryKey: ['admin-actions'],
    queryFn: async () => (await api.get<{ items: ActionLogRow[]; total: number }>('/admin/actions')).data,
  });

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Действия админов</h1>
        <p className="mt-1 text-sm text-gray-500">Аудит ручных действий — смена подписок и другие изменения компаний</p>
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
                  <TableCell className="text-xs">{a.action}</TableCell>
                  <TableCell className="text-xs text-gray-500">{JSON.stringify(a.previousValue)}</TableCell>
                  <TableCell className="text-xs text-gray-500">{JSON.stringify(a.newValue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data && data.items.length === 0 && <p className="p-4 text-sm text-gray-400">Действий не зафиксировано</p>}
        </CardContent>
      </Card>
    </div>
  );
}
