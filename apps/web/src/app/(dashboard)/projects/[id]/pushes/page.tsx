'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Plus, Pencil, Copy } from 'lucide-react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';

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

interface BestTimeStats {
  byHour: { hour: number; sent: number; clicked: number; ctr: number }[];
  recommendedHour: number | null;
  totalSent: number;
  totalClicked: number;
}

// Smart Push Timing (Фаза 3.4, запрос пользователя 2026-07-15) — чисто аналитическая карточка,
// ничего не меняет в отправке, только показывает рекомендацию. Считает только пуши с кнопками
// (Telegram не сообщает об открытии сообщения без кнопки), см. PushesService.getBestTimeStats.
function BestTimeCard({ projectId }: { projectId: string }) {
  const { data: stats } = useQuery({
    queryKey: ['pushes', projectId, 'best-time'],
    queryFn: async () => (await api.get<BestTimeStats>(`/projects/${projectId}/pushes/stats/best-time`)).data,
  });

  if (!stats) return null;

  if (stats.totalSent === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Оптимальное время отправки</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Пока нет данных — статистика появится, когда рассылки с кнопками начнут набирать клики.
          </p>
        </CardContent>
      </Card>
    );
  }

  const chartData = Array.from({ length: 24 }, (_, hour) => stats.byHour.find((h) => h.hour === hour) ?? { hour, sent: 0, clicked: 0, ctr: 0 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Оптимальное время отправки</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          {stats.recommendedHour !== null ? (
            <>
              Лучшее время: <span className="font-medium">{stats.recommendedHour}:00</span>
            </>
          ) : (
            <span className="text-muted-foreground">Пока недостаточно данных для рекомендации.</span>
          )}
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} fontSize={12} interval={1} />
            <YAxis fontSize={12} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
            <Tooltip
              labelFormatter={(h) => `${h}:00`}
              formatter={(v, name) => (name === 'ctr' ? [`${(Number(v) * 100).toFixed(1)}%`, 'CTR'] : [v, name])}
            />
            <Bar dataKey="ctr">
              {chartData.map((d) => (
                <Cell key={d.hour} fill={d.hour === stats.recommendedHour ? '#2563eb' : '#93c5fd'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'secondary',
  SCHEDULED: 'outline',
  SENDING: 'default',
  SENT: 'default',
  CANCELLED: 'destructive',
};

interface PushLogItem {
  id: string;
  status: string;
  error: string | null;
  sentAt: string | null;
  clickedAt: string | null;
  client: { id: string; tgUsername: string | null; tgFirstName: string | null } | null;
}

// Логи ошибок при открытии рассылки (запрос пользователя 2026-07-17: "добавь логи ошибок
// при открытии рассылки") — раньше PushLog.error всегда писал одинаковое "send failed",
// теперь там реальный текст ответа Telegram/WhatsApp/Instagram (см. SendMessageResult) —
// эндпоинт GET /pushes/:id/logs уже существовал, просто не было UI, чтобы его открыть.
function PushLogsDialog({ projectId, pushId, onClose }: { projectId: string; pushId: string; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['pushes', projectId, pushId, 'logs'],
    queryFn: async () => (await api.get<{ items: PushLogItem[]; total: number }>(`/projects/${projectId}/pushes/${pushId}/logs`)).data,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Логи отправки</DialogTitle>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Получатель</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Ошибка</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="whitespace-nowrap">
                  {log.client?.tgUsername ? `@${log.client.tgUsername}` : log.client?.tgFirstName || log.client?.id || '—'}
                </TableCell>
                <TableCell>
                  <Badge variant={log.status === 'sent' ? 'default' : log.status === 'failed' ? 'destructive' : 'secondary'}>
                    {log.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-red-500 max-w-md break-words">{log.error || '—'}</TableCell>
              </TableRow>
            ))}
            {data && data.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  Логов пока нет
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

export default function PushesPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [openLogsFor, setOpenLogsFor] = useState<string | null>(null);

  const { data: pushes } = useQuery({
    queryKey: ['pushes', projectId],
    queryFn: async () => (await api.get<PushRow[]>(`/projects/${projectId}/pushes`)).data,
  });

  const cancelPush = useMutation({
    mutationFn: (pushId: string) => api.delete(`/projects/${projectId}/pushes/${pushId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pushes', projectId] }),
  });

  // Копирование (запрос пользователя 2026-08-05: "вдруг надо будет отправить её ещё раз") —
  // создаёт новый DRAFT на бэкенде и сразу переводит на его страницу редактирования, чтобы можно
  // было проверить/поправить контент и расписание перед повторной отправкой, а не молча упасть
  // в список рядом с оригиналом.
  const duplicatePush = useMutation({
    mutationFn: (pushId: string) => api.post<{ id: string }>(`/projects/${projectId}/pushes/${pushId}/duplicate`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['pushes', projectId] });
      router.push(`/projects/${projectId}/pushes/${res.data.id}/edit`);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Рассылки</h1>
        {hasPermission(user, projectId, 'PUSHES_CREATE') && (
          <Button
            nativeButton={false}
            render={
              <Link href={`/projects/${projectId}/pushes/new`}>
                <Plus className="w-4 h-4 mr-1.5" /> Новая рассылка
              </Link>
            }
          />
        )}
      </div>

      <BestTimeCard projectId={projectId} />

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
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pushes?.map((push) => (
              <TableRow key={push.id} className="cursor-pointer hover:bg-muted" onClick={() => setOpenLogsFor(push.id)}>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[push.status] || 'secondary'}>{push.status}</Badge>
                </TableCell>
                <TableCell className="font-medium">{push.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {push.sentAt
                    ? format(new Date(push.sentAt), 'd MMM HH:mm')
                    : push.scheduledAt
                      ? format(new Date(push.scheduledAt), 'd MMM HH:mm')
                      : '—'}
                </TableCell>
                <TableCell>{push.audienceReachable}</TableCell>
                <TableCell>{push.sentCount}</TableCell>
                <TableCell className={push.failedCount > 0 ? 'text-red-500 font-medium' : undefined}>{push.failedCount}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()} className="whitespace-nowrap">
                  {(push.status === 'DRAFT' || push.status === 'SCHEDULED') && hasPermission(user, projectId, 'PUSHES_CREATE') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      nativeButton={false}
                      render={
                        <Link href={`/projects/${projectId}/pushes/${push.id}/edit`}>
                          <Pencil className="w-3.5 h-3.5 mr-1" /> Изменить
                        </Link>
                      }
                    />
                  )}
                  {hasPermission(user, projectId, 'PUSHES_CREATE') && (
                    <Button size="sm" variant="ghost" onClick={() => duplicatePush.mutate(push.id)} disabled={duplicatePush.isPending}>
                      <Copy className="w-3.5 h-3.5 mr-1" /> Копировать
                    </Button>
                  )}
                  {(push.status === 'DRAFT' || push.status === 'SCHEDULED') && hasPermission(user, projectId, 'PUSHES_DELETE') && (
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

      {openLogsFor && <PushLogsDialog projectId={projectId} pushId={openLogsFor} onClose={() => setOpenLogsFor(null)} />}
    </div>
  );
}
