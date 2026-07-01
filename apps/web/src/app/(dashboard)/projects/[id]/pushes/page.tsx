'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface PushRow {
  id: string;
  name: string;
  status: string;
  audienceReachable: number;
  sentCount: number;
  failedCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'secondary',
  SCHEDULED: 'outline',
  SENDING: 'default',
  SENT: 'default',
  CANCELLED: 'destructive',
};

export default function PushesPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: pushes } = useQuery({
    queryKey: ['pushes', projectId],
    queryFn: async () => (await api.get<PushRow[]>(`/projects/${projectId}/pushes`)).data,
  });

  const cancelPush = useMutation({
    mutationFn: (pushId: string) => api.delete(`/projects/${projectId}/pushes/${pushId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pushes', projectId] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Рассылки</h1>
        <Button
          nativeButton={false}
          render={
            <Link href={`/projects/${projectId}/pushes/new`}>
              <Plus className="w-4 h-4 mr-1.5" /> Новая рассылка
            </Link>
          }
        />
      </div>

      <div className="border rounded-lg bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Статус</TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Аудитория</TableHead>
              <TableHead>Отправлено</TableHead>
              <TableHead>Ошибки</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pushes?.map((push) => (
              <TableRow key={push.id}>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[push.status] || 'secondary'}>{push.status}</Badge>
                </TableCell>
                <TableCell className="font-medium">{push.name}</TableCell>
                <TableCell className="text-gray-500">
                  {push.sentAt
                    ? format(new Date(push.sentAt), 'd MMM HH:mm')
                    : push.scheduledAt
                      ? format(new Date(push.scheduledAt), 'd MMM HH:mm')
                      : '—'}
                </TableCell>
                <TableCell>{push.audienceReachable}</TableCell>
                <TableCell>{push.sentCount}</TableCell>
                <TableCell>{push.failedCount}</TableCell>
                <TableCell>
                  {(push.status === 'DRAFT' || push.status === 'SCHEDULED') && (
                    <Button size="sm" variant="ghost" onClick={() => cancelPush.mutate(push.id)}>
                      Отменить
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
