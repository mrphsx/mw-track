'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Loader2, Send } from 'lucide-react';
import { BroadcastFilter, ConversationFilters, TEMPLATE_KIND_LABEL, cancelChatBroadcast, fetchChatBroadcasts } from '@/lib/chat';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BroadcastComposer } from './broadcast-composer';
import { ChatSource } from '@/lib/chat';

// Рассылка прямо из чата (2026-10-25): выбранным диалогам или всем по текущему фильтру списка.
// Каждое сообщение ложится в переписку как обычный ответ.

// 2026-10-26: «рассылка внизу чата не соответствует рассылке во вкладке» — теперь это тот же
// конструктор (варианты, файлы, интервал, дата), с подставленным фильтром списка или выбранными диалогами.
export function BroadcastDialog({
  filter,
  conversationIds,
  onClose,
  onCreated,
}: {
  filter: BroadcastFilter & ConversationFilters;
  conversationIds?: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { projectId, source, ...initial } = filter;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader className="sr-only">
          <DialogTitle>Рассылка из чата</DialogTitle>
        </DialogHeader>
        <BroadcastComposer projectId={projectId} source={source} initial={initial} conversationIds={conversationIds} embedded onDone={onCreated} onCancel={onClose} />
      </DialogContent>
    </Dialog>
  );
}

const STATUS_LABEL: Record<string, string> = { PENDING: 'Запланирована', RUNNING: 'Идёт', DONE: 'Завершена', CANCELLED: 'Отменена' };

// Вкладка «Рассылки» в полосе над чатами — история и прогресс.
// Рассылки открытого сверху ресурса — бота или лички (2026-10-25).
export function BroadcastsPanel({ projectId, source }: { projectId: string; source: ChatSource }) {
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['chat-broadcasts', projectId, source],
    queryFn: () => fetchChatBroadcasts(projectId, source),
    refetchInterval: 5000,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelChatBroadcast(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat-broadcasts', projectId] }),
  });

  if (composing) {
    return (
      <BroadcastComposer
        projectId={projectId}
        source={source}
        onCancel={() => setComposing(false)}
        onDone={() => {
          setComposing(false);
          queryClient.invalidateQueries({ queryKey: ['chat-broadcasts', projectId] });
        }}
      />
    );
  }

  return (
    <div className="rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-5 max-w-3xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3]">Рассылки {source === 'PERSONAL' ? 'с лички' : 'через бота'}</h2>
          <p className="mt-1 text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
            Отправляются лидам прямо в их переписку. Быстро разослать можно и из «Чатов»: «Выбрать» → «Разослать выбранным».
          </p>
        </div>
        {(
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="shrink-0 h-9 px-3 rounded-lg text-sm font-semibold bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] inline-flex items-center gap-1.5"
          >
            <Send className="w-4 h-4" /> Новая рассылка
          </button>
        )}
      </div>
      {isLoading && <Loader2 className="w-4 h-4 animate-spin text-[#5F6B7A]" />}
      {data?.length === 0 && <div className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Рассылок пока не было.</div>}
      <div className="space-y-2">
        {data?.map((b) => {
          const done = b.sent + b.failed;
          const pct = b.total ? Math.round((done / b.total) * 100) : 0;
          return (
            <div key={b.id} className="rounded-lg border border-[#DCE1E8] dark:border-white/10 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    b.status === 'RUNNING' && 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]',
                    b.status === 'DONE' && 'bg-[#1F7A6C]/10 text-[#1F7A6C] dark:bg-[#6FCBBA]/10 dark:text-[#6FCBBA]',
                    b.status === 'PENDING' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
                    b.status === 'CANCELLED' && 'bg-[#F3F5F8] text-[#5F6B7A] dark:bg-white/5 dark:text-[#92A0AF]',
                  )}
                >
                  {STATUS_LABEL[b.status]}
                </span>
                <span className="text-[#5F6B7A] dark:text-[#92A0AF] text-xs">
                  {b.status === 'PENDING' ? `на ${format(new Date(b.sendAt), 'd MMM, HH:mm', { locale: ru })}` : format(new Date(b.createdAt), 'd MMM, HH:mm', { locale: ru })}
                  {b.createdByName && ` · ${b.createdByName}`}
                </span>
                {(b.status === 'PENDING' || b.status === 'RUNNING') && (
                  <button
                    type="button"
                    onClick={() => confirm('Остановить рассылку? Уже отправленное останется.') && cancel.mutate(b.id)}
                    className="ml-auto text-xs text-red-600 hover:underline"
                  >
                    Остановить
                  </button>
                )}
              </div>
              <div className="space-y-0.5">
                {b.variants.map((v, i) => (
                  <div key={i} className="text-sm text-[#131A24] dark:text-[#E9EDF3] line-clamp-1">
                    {b.variants.length > 1 && <span className="text-xs text-[#5F6B7A] mr-1">{i + 1}.</span>}
                    {v.template && <span className="font-mono text-[#1F4E9C] dark:text-[#7BA9EE]">#{v.template.code} </span>}
                    {v.parts?.some((p) => p.mediaKind) && (
                      <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] mr-1">
                        [{v.parts.filter((p) => p.mediaKind).map((p) => TEMPLATE_KIND_LABEL[p.mediaKind!].toLowerCase()).join(', ')}]
                      </span>
                    )}
                    {v.text}
                    {v.parts && v.parts.length > 1 && <span className="text-xs text-[#5F6B7A] ml-1">· {v.parts.length} сообщ.</span>}
                  </div>
                ))}
              </div>
              <div className="h-1.5 rounded-full bg-[#F3F5F8] dark:bg-white/5 overflow-hidden">
                <div className="h-full bg-[#1F4E9C] dark:bg-[#7BA9EE] transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] tabular-nums">
                Отправлено {b.sent} из {b.total}
                {b.delayMinSec != null && ` · пауза ${b.delayMinSec}–${b.delayMaxSec} сек`}
                {b.failed > 0 && <span className="text-red-600 dark:text-red-400"> · не дошло {b.failed}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
