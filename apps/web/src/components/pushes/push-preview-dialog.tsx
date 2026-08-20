'use client';

import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TelegramMessagePreview, TelegramMessageMediaItem } from '@/components/messages/telegram-message-preview';

interface PushDetail {
  id: string;
  name: string;
  status: string;
  messageText: string;
  messageMedia: TelegramMessageMediaItem[] | null;
  buttons: { text: string; url?: string }[] | null;
  audienceTotal: number;
  audienceReachable: number;
  sentCount: number;
  failedCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface PushLogItem {
  id: string;
  status: string;
  error: string | null;
  client: { id: string; tgUsername: string | null; tgFirstName: string | null } | null;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'secondary',
  SCHEDULED: 'outline',
  SENDING: 'default',
  SENT: 'default',
  CANCELLED: 'destructive',
  FAILED: 'destructive',
};

// Мини-превью рассылки (запрос пользователя 2026-08-18: "показывать мини превью рассылки если её
// открыть... для более лёгкого понимания что внутри, можно смотреть любые — новые, старые,
// отменённые, в драфте, запланированные") — один общий диалог для всех 4 списков рассылок
// (project-scoped + company-wide, оба дерева): сложные разовые попапы в этом проекте не
// переоформляются под Studio (тот же принцип, что у AbTestGroupDialog/GetLinkDialog), а с
// 2026-08-18 обычный shadcn Dialog и так уже красится в реальную тёмную тему Studio (см.
// globals.css .studio.dark). Контент — тот же TelegramMessagePreview, что и в композере (честное
// "как это увидит получатель"), плюс сводка по аудитории/отправке и логи ниже. Раньше клик по
// строке открывал только "Логи отправки" (PushLogsDialog, независимо задублированный в 4 местах)
// — эта версия заменяет его везде, работает для ЛЮБОГО статуса: для ещё не отправленных
// DRAFT/SCHEDULED логов просто пока нет, таблица покажет "Логов пока нет" вместо ошибки.
export function PushPreviewDialog({ projectId, pushId, onClose }: { projectId: string; pushId: string; onClose: () => void }) {
  // staleTime/gcTime: 0 (запрос пользователя 2026-08-18: "первые секунды показывает содержимое
  // старого пуша, потом обновляется") — глобальный QueryClient (providers.tsx) держит
  // staleTime 30с по умолчанию, так что при повторном открытии этого попапа (например, после
  // редактирования только что просмотренного пуша, или для другого пуша, если родитель не
  // размонтировал прошлый экземпляр между кликами) react-query до 30с отдавал СТАРЫЙ закэшированный
  // контент немедленно и лишь потом (если вообще) обновлял его фоновым рефетчем. Превью пуша —
  // редко открываемый разовый попап, а не список, где повторное использование кэша оправдано;
  // здесь свежесть важнее экономии одного запроса. gcTime: 0 гарантирует, что кэш этого пуша
  // стирается сразу при закрытии попапа — следующее открытие ЛЮБОГО пуша всегда чистый fetch.
  const { data: push } = useQuery({
    queryKey: ['push-preview', projectId, pushId],
    queryFn: async () => (await api.get<PushDetail>(`/projects/${projectId}/pushes/${pushId}`)).data,
    staleTime: 0,
    gcTime: 0,
  });
  const { data: logs } = useQuery({
    queryKey: ['pushes', projectId, pushId, 'logs'],
    queryFn: async () => (await api.get<{ items: PushLogItem[]; total: number }>(`/projects/${projectId}/pushes/${pushId}/logs`)).data,
    staleTime: 0,
    gcTime: 0,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {push?.name ?? '...'}
            {push && <Badge variant={STATUS_VARIANT[push.status] || 'secondary'}>{push.status}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {push && (
          <div className="space-y-4">
            <TelegramMessagePreview
              text={push.messageText}
              media={push.messageMedia ?? []}
              buttons={(push.buttons ?? []).map((b) => ({ text: b.text, url: b.url ?? '' }))}
              label="Содержимое"
            />

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm border-t pt-4">
              <div>
                <div className="text-xs text-muted-foreground">Аудитория</div>
                <div className="font-medium">
                  {push.audienceReachable} / {push.audienceTotal}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Отправлено</div>
                <div className="font-medium">{push.sentCount}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Ошибок</div>
                <div className={push.failedCount > 0 ? 'font-medium text-red-500' : 'font-medium'}>{push.failedCount}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{push.sentAt ? 'Отправлена' : push.scheduledAt ? 'Запланирована' : 'Создана'}</div>
                <div className="font-medium">{format(new Date(push.sentAt || push.scheduledAt || push.createdAt), 'd MMM yyyy, HH:mm')}</div>
              </div>
            </div>
          </div>
        )}

        <div>
          <div className="text-sm font-medium mb-2">Логи отправки</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Получатель</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Ошибка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs?.items.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap">
                    {log.client?.tgUsername ? `@${log.client.tgUsername}` : log.client?.tgFirstName || log.client?.id || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={log.status === 'sent' ? 'default' : log.status === 'failed' ? 'destructive' : 'secondary'}>{log.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-red-500 max-w-md break-words">{log.error || '—'}</TableCell>
                </TableRow>
              ))}
              {logs && logs.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    Логов пока нет
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
