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
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';

interface BroadcastRow {
  id: string;
  name: string;
  status: string;
  audienceTotal: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface ProjectDetail {
  id: string;
  channel: { tgPersonalConnected: boolean } | null;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'secondary',
  SCHEDULED: 'outline',
  SENDING: 'default',
  SENT: 'default',
  FAILED: 'destructive',
  CANCELLED: 'destructive',
};

// Рассылка с личного MTProto-аккаунта (запрос пользователя 2026-08-06) — параллельная бот-пушам
// фича: другой механизм отправки (GramJS, не Bot API), другая аудитория (диалог именно с личным
// аккаунтом), другой темп (пауза между каждым получателем, не очередь с лимитом). Project-scoped
// список, тот же UI-язык, что и .../pushes/page.tsx, но без BestTimeCard (там нет клик-трекинга
// у этой фичи) и с доп. колонкой "Пропущено" (диалог не подтвердился живой проверкой перед
// отправкой).
export default function PersonalBroadcastsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.get<ProjectDetail>(`/projects/${projectId}`)).data,
  });

  const { data: broadcasts } = useQuery({
    queryKey: ['personal-broadcasts', projectId],
    queryFn: async () => (await api.get<BroadcastRow[]>(`/projects/${projectId}/personal-broadcasts`)).data,
    enabled: !!project?.channel?.tgPersonalConnected,
  });

  const cancel = useMutation({
    mutationFn: (broadcastId: string) => api.delete(`/projects/${projectId}/personal-broadcasts/${broadcastId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['personal-broadcasts', projectId] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Рассылка с личного аккаунта</h1>
          <p className="text-sm text-muted-foreground mt-1">Всем, у кого есть реальный диалог с подключённым личным Telegram-аккаунтом</p>
        </div>
        {project?.channel?.tgPersonalConnected && hasPermission(user, projectId, 'PERSONAL_BROADCASTS_CREATE') && (
          <Button
            nativeButton={false}
            render={
              <Link href={`/projects/${projectId}/personal-broadcasts/new`}>
                <Plus className="w-4 h-4 mr-1.5" /> Новая рассылка
              </Link>
            }
          />
        )}
      </div>

      {project && !project.channel?.tgPersonalConnected && (
        <div className="border rounded-lg bg-card p-6 text-sm text-muted-foreground">
          К этому проекту не подключён личный Telegram-аккаунт — подключите его в настройках проекта, чтобы начать рассылку.
        </div>
      )}

      {project?.channel?.tgPersonalConnected && (
        <div className="border rounded-lg bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Статус</TableHead>
                <TableHead>Название</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead>Аудитория</TableHead>
                <TableHead>Отправлено</TableHead>
                <TableHead>Ошибки</TableHead>
                <TableHead>Пропущено</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {broadcasts?.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[b.status] || 'secondary'}>{b.status}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.sentAt
                      ? format(new Date(b.sentAt), 'd MMM HH:mm')
                      : b.scheduledAt
                        ? format(new Date(b.scheduledAt), 'd MMM HH:mm')
                        : '—'}
                  </TableCell>
                  <TableCell>{b.audienceTotal}</TableCell>
                  <TableCell>{b.sentCount}</TableCell>
                  <TableCell className={b.failedCount > 0 ? 'text-red-500 font-medium' : undefined}>{b.failedCount}</TableCell>
                  <TableCell className={b.skippedCount > 0 ? 'text-amber-600 font-medium' : undefined}>{b.skippedCount}</TableCell>
                  <TableCell>
                    {(b.status === 'DRAFT' || b.status === 'SCHEDULED' || b.status === 'SENDING') &&
                      hasPermission(user, projectId, 'PERSONAL_BROADCASTS_DELETE') && (
                        <Button size="sm" variant="ghost" onClick={() => cancel.mutate(b.id)}>
                          Отменить
                        </Button>
                      )}
                  </TableCell>
                </TableRow>
              ))}
              {broadcasts && broadcasts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    Рассылок пока нет
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
