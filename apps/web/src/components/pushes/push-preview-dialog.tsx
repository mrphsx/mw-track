'use client';

import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  createdBy?: { id: string; name: string } | null;
}

// Сводка по получателям (2026-10-26: «в списке ошибок — просто ошибка и сколько людей под неё
// попали»): статусы и ошибки, сведённые сервером к понятным причинам.
interface ErrorSummary {
  statuses: Record<string, number>;
  errors: { error: string; count: number }[];
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
  const { data: summary } = useQuery({
    queryKey: ['pushes', projectId, pushId, 'error-summary'],
    queryFn: async () => (await api.get<ErrorSummary>(`/projects/${projectId}/pushes/${pushId}/error-summary`)).data,
    staleTime: 0,
    gcTime: 0,
  });
  const totalLogged = summary ? Object.values(summary.statuses).reduce((a, b) => a + b, 0) : 0;
  const pending = summary ? (summary.statuses.pending ?? 0) + (summary.statuses.sending ?? 0) : 0;

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
            <div className="text-sm">
              <span className="text-muted-foreground">Создал: </span>
              <span className="font-medium">{push.createdBy?.name ?? 'неизвестно (создана до 26.10.2026)'}</span>
              <span className="text-muted-foreground"> · {format(new Date(push.createdAt), 'd MMM yyyy, HH:mm')}</span>
            </div>
          </div>
        )}

        <div>
          <div className="text-sm font-medium mb-2">Ошибки отправки</div>
          {!summary ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : totalLogged === 0 ? (
            <p className="text-sm text-muted-foreground">Рассылка ещё не отправлялась.</p>
          ) : (
            <div className="space-y-2">
              {pending > 0 && <p className="text-xs text-muted-foreground">Ещё отправляется: {pending}</p>}
              {summary.errors.length === 0 ? (
                <p className="text-sm text-emerald-600 dark:text-emerald-400">Ошибок нет — всё доставлено.</p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {summary.errors.map((e) => (
                    <div key={e.error} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 break-words">{e.error}</span>
                      <span className="shrink-0 font-mono tabular-nums font-semibold text-red-500">{e.count.toLocaleString('ru-RU')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
