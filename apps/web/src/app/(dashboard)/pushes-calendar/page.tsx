'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Plus, Send, Pencil, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarGrid } from '@/components/pushes/calendar-grid';
import { DayScheduleList, DayScheduleItem } from '@/components/pushes/day-schedule-list';
import { PushPreviewDialog } from '@/components/pushes/push-preview-dialog';
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
  project: { id: string; name: string };
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'secondary',
  SCHEDULED: 'outline',
  SENDING: 'default',
  SENT: 'default',
  CANCELLED: 'destructive',
  FAILED: 'destructive',
};

// "Рассылки" (запрос пользователя 2026-08-04, переименовано из "Календарь рассылок") — тот же
// календарь по всей компании, что и раньше (CalendarGrid/DayScheduleList, company-wide
// эндпоинты /pushes/scheduled-summary, /pushes/scheduled-day, видимость уже ограничена
// доступными пользователю проектами), плюс подробный список ВСЕХ рассылок ниже (GET /pushes) и
// синяя кнопка создания, ведущая на единую страницу /pushes/new (мульти-проектный выбор).
export default function PushesCalendarPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [visibleMonth, setVisibleMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [previewPush, setPreviewPush] = useState<{ projectId: string; pushId: string } | null>(null);

  const monthKey = format(visibleMonth, 'yyyy-MM');
  const { data: summary } = useQuery({
    queryKey: ['pushes-global-scheduled-summary', monthKey],
    queryFn: async () => (await api.get<{ date: string; count: number }[]>('/pushes/scheduled-summary', { params: { month: monthKey } })).data,
  });
  const counts = new Map((summary ?? []).map((s) => [s.date, s.count]));

  const dateKey = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
  const { data: dayItems, isFetching: dayLoading } = useQuery({
    queryKey: ['pushes-global-scheduled-day', dateKey],
    queryFn: async () => (await api.get<DayScheduleItem[]>('/pushes/scheduled-day', { params: { date: dateKey } })).data,
    enabled: !!dateKey,
  });

  // Два таба (запрос пользователя 2026-08-04: "показывай только те что в ожидании... сделай и
  // таб для тех что уже были, подгружай только когда нажимают") — pending загружается сразу,
  // history — отдельный запрос с enabled: activeTab==='history', первый клик на таб и запускает
  // загрузку (react-query дальше кэширует, повторные переключения не бьют по сети).
  const [listTab, setListTab] = useState<'pending' | 'history'>('pending');
  const { data: pendingPushes } = useQuery({
    queryKey: ['pushes-global-all', 'pending'],
    queryFn: async () => (await api.get<PushRow[]>('/pushes', { params: { scope: 'pending' } })).data,
  });
  const { data: historyPushes, isFetching: historyLoading } = useQuery({
    queryKey: ['pushes-global-all', 'history'],
    queryFn: async () => (await api.get<PushRow[]>('/pushes', { params: { scope: 'history' } })).data,
    enabled: listTab === 'history',
  });
  const allPushes = listTab === 'pending' ? pendingPushes : historyPushes;

  // Действия прямо на этой странице (запрос пользователя 2026-08-05: "прямо на странице рассылок
  // должна быть функция отменить и редактировать, а не только на странице рассылок канала") —
  // раньше эта таблица была read-only, все действия требовали перехода на /projects/:id/pushes.
  // Каждая строка уже несёт push.project.id (findAllForCompany отдаёт его вместе с пушем) —
  // используем его напрямую для вызова project-scoped эндпоинтов, отдельный company-wide
  // PATCH/DELETE не нужен.
  const invalidatePushLists = () => {
    queryClient.invalidateQueries({ queryKey: ['pushes-global-all'] });
    queryClient.invalidateQueries({ queryKey: ['pushes-global-scheduled-summary'] });
    queryClient.invalidateQueries({ queryKey: ['pushes-global-scheduled-day'] });
  };
  const cancelPush = useMutation({
    mutationFn: ({ projectId, pushId }: { projectId: string; pushId: string }) => api.delete(`/projects/${projectId}/pushes/${pushId}`),
    onSuccess: invalidatePushLists,
  });
  const duplicatePush = useMutation({
    mutationFn: ({ projectId, pushId }: { projectId: string; pushId: string }) =>
      api.post<{ id: string }>(`/projects/${projectId}/pushes/${pushId}/duplicate`),
    onSuccess: (res, vars) => {
      invalidatePushLists();
      router.push(`/projects/${vars.projectId}/pushes/${res.data.id}/edit`);
    },
  });

  // Без ограничения ширины (запрос пользователя 2026-07-31: "увеличь его на всю ширину для
  // удобства") — DayScheduleList уже flex-1, растягивается сама.
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Send className="h-6 w-6" /> Рассылки
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Все запланированные рассылки по всем проектам сразу</p>
        </div>
        <Button
          nativeButton={false}
          render={
            <Link href="/pushes/new">
              <Plus className="w-4 h-4 mr-1.5" /> Создать рассылку
            </Link>
          }
        />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-start gap-6 p-6">
          <CalendarGrid
            visibleMonth={visibleMonth}
            onMonthChange={setVisibleMonth}
            counts={counts}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
          <DayScheduleList date={selectedDate} items={dayItems} isLoading={dayLoading} showProject />
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-border p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => setListTab('pending')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              listTab === 'pending' ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            В ожидании
          </button>
          <button
            type="button"
            onClick={() => setListTab('history')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              listTab === 'history' ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            Уже были
          </button>
        </div>
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Статус</TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Проект</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Аудитория</TableHead>
              <TableHead>Отправлено</TableHead>
              <TableHead>Ошибки</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {listTab === 'history' && historyLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  Загрузка...
                </TableCell>
              </TableRow>
            )}
            {allPushes?.map((push) => (
              <TableRow
                key={push.id}
                className="cursor-pointer hover:bg-muted"
                onClick={() => setPreviewPush({ projectId: push.project.id, pushId: push.id })}
              >
                <TableCell>
                  <Badge variant={STATUS_VARIANT[push.status] || 'secondary'}>{push.status}</Badge>
                </TableCell>
                <TableCell className="font-medium">{push.name}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Link href={`/projects/${push.project.id}/pushes`} className="text-blue-600 hover:underline">
                    {push.project.name}
                  </Link>
                </TableCell>
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
                <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  {(push.status === 'DRAFT' || push.status === 'SCHEDULED') && hasPermission(user, push.project.id, 'PUSHES_CREATE') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      nativeButton={false}
                      render={
                        <Link href={`/projects/${push.project.id}/pushes/${push.id}/edit`}>
                          <Pencil className="w-3.5 h-3.5 mr-1" /> Изменить
                        </Link>
                      }
                    />
                  )}
                  {hasPermission(user, push.project.id, 'PUSHES_CREATE') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => duplicatePush.mutate({ projectId: push.project.id, pushId: push.id })}
                      disabled={duplicatePush.isPending}
                    >
                      <Copy className="w-3.5 h-3.5 mr-1" /> Копировать
                    </Button>
                  )}
                  {(push.status === 'DRAFT' || push.status === 'SCHEDULED') && hasPermission(user, push.project.id, 'PUSHES_DELETE') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => cancelPush.mutate({ projectId: push.project.id, pushId: push.id })}
                    >
                      Отменить
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {allPushes && allPushes.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  Рассылок пока нет
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {previewPush && (
        <PushPreviewDialog key={previewPush.pushId} projectId={previewPush.projectId} pushId={previewPush.pushId} onClose={() => setPreviewPush(null)} />
      )}
    </div>
  );
}
