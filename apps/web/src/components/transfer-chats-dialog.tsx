'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Plus, Trash2 } from 'lucide-react';
import { ChatSource, fetchTransferSummary, transferChats } from '@/lib/chat';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Передать все чаты оператора разом (2026-10-26: «как передать чаты обработчика разом кому-то
// другому» + «что будет с чатами, когда он уволен/удалён/заблокирован» — выбор при удалении):
// одному оператору, по долям между несколькими или снять ответственного (чаты уйдут тимлиду в
// «Без ответственного»). beforeRemove — окно открыто перед отключением оператора: после решения
// вызывается onDone, и уже страница отключает доступ.

const SOURCE_LABEL: Record<ChatSource, string> = { BOT: 'бот', PERSONAL: 'личка' };

interface Row {
  key: number;
  userId: string;
  weight: number;
}
let seq = 0;

export function TransferChatsDialog({
  fromUserId,
  initialProjectId,
  initialSource,
  beforeRemove,
  onDone,
  onClose,
}: {
  fromUserId: string;
  initialProjectId?: string;
  initialSource?: ChatSource;
  // Текст действия после решения, например «и отключить» / «и сохранить».
  beforeRemove?: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['chat-transfer-summary', fromUserId],
    queryFn: () => fetchTransferSummary(fromUserId),
    staleTime: 0,
    gcTime: 0,
  });
  // Область: '' — все проекты, иначе 'projectId' или 'projectId:SOURCE'.
  const [scope, setScope] = useState(initialProjectId ? `${initialProjectId}${initialSource ? `:${initialSource}` : ''}` : '');
  const [mode, setMode] = useState<'transfer' | 'unassign'>('transfer');
  const [rows, setRows] = useState<Row[]>([{ key: ++seq, userId: '', weight: 100 }]);
  const [error, setError] = useState('');

  const groups = data?.groups ?? [];
  // Область из чата может не совпасть с тем, что есть (например, у оператора нет чатов лички).
  useEffect(() => {
    if (!data || !scope) return;
    const [pid, src] = scope.split(':');
    if (!groups.some((g) => g.projectId === pid && (!src || g.source === src))) setScope(groups.some((g) => g.projectId === pid) ? pid : '');
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const [scopeProject, scopeSource] = scope ? (scope.split(':') as [string, ChatSource | undefined]) : [undefined, undefined];
  const inScope = groups.filter((g) => (!scopeProject || g.projectId === scopeProject) && (!scopeSource || g.source === scopeSource));
  const count = inScope.reduce((s, g) => s + g.count, 0);
  const projectsInGroups = Array.from(new Map(groups.map((g) => [g.projectId, g.projectName])).entries());

  const active = rows.filter((r) => r.userId && r.weight > 0);
  const total = active.reduce((s, r) => s + r.weight, 0);
  const duplicate = new Set(active.map((r) => r.userId)).size !== active.length;
  const transferInvalid = mode === 'transfer' && (active.length === 0 || duplicate || (active.length > 1 && total !== 100));

  const run = useMutation({
    mutationFn: () =>
      transferChats({
        fromUserId,
        projectId: scopeProject,
        source: scopeSource,
        targets: mode === 'unassign' ? [] : active.length === 1 ? [{ userId: active[0].userId, weight: 100 }] : active.map((r) => ({ userId: r.userId, weight: r.weight })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['chat-conversation'] });
      queryClient.invalidateQueries({ queryKey: ['chat-access'] });
      queryClient.invalidateQueries({ queryKey: ['chat-distribution'] });
      onDone();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось передать чаты'),
  });

  const splitEvenly = () => {
    const filled = rows.filter((r) => r.userId);
    if (!filled.length) return;
    const base = Math.floor(100 / filled.length);
    let i = 0;
    setRows((prev) => prev.map((r) => (r.userId ? { ...r, weight: base + (i++ < 100 - base * filled.length ? 1 : 0) } : r)));
  };

  const SELECT = 'h-9 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30';
  const nothing = !!data && data.total === 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{beforeRemove ? 'Что сделать с чатами оператора?' : 'Передать чаты оператора'}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : isError || !data ? (
          <div className="space-y-3">
            <p className="text-sm text-red-500">Не удалось загрузить чаты оператора.</p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>
                Закрыть
              </Button>
            </div>
          </div>
        ) : nothing ? (
          <div className="space-y-3">
            <p className="text-sm">
              За <b>{data.from.name}</b> не числится ни одного диалога{data.hidden ? ' в ваших проектах' : ''}.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                {beforeRemove ? 'Отмена' : 'Закрыть'}
              </Button>
              {beforeRemove && <Button onClick={onDone}>Продолжить {beforeRemove}</Button>}
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <p>
              За <b>{data.from.name}</b> числится диалогов: <b className="tabular-nums">{data.total}</b>.
              {beforeRemove && ' Без решения они останутся за ним и операторы их не увидят.'}
            </p>
            {data.hidden > 0 && <p className="text-xs text-muted-foreground">Ещё {data.hidden} — в проектах, где вы не управляете операторами; их это не затронет.</p>}

            {/* Перед отключением — всегда все чаты, иначе часть останется «зависшей». */}
            {!beforeRemove && (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Какие чаты</span>
              <select value={scope} onChange={(e) => setScope(e.target.value)} className={cn(SELECT, 'w-full')}>
                <option value="">Все проекты ({data.total})</option>
                {projectsInGroups.map(([pid, name]) => {
                  const sub = groups.filter((g) => g.projectId === pid);
                  return [
                    <option key={pid} value={pid}>
                      {name} ({sub.reduce((s, g) => s + g.count, 0)})
                    </option>,
                    ...(sub.length > 1
                      ? sub.map((g) => (
                          <option key={`${pid}:${g.source}`} value={`${pid}:${g.source}`}>
                            {'   '}
                            {name} · {SOURCE_LABEL[g.source]} ({g.count})
                          </option>
                        ))
                      : []),
                  ];
                })}
              </select>
            </label>
            )}

            <div className="space-y-2">
              {(
                [
                  ['transfer', 'Передать другому оператору', 'Одному или по долям между несколькими'],
                  ['unassign', 'Снять ответственного', 'Чаты уйдут тимлиду в «Без ответственного» — он раздаст их сам'],
                ] as const
              ).map(([id, label, hint]) => (
                <label key={id} className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer', mode === id ? 'border-primary bg-primary/5' : 'border-input')}>
                  <input type="radio" className="mt-1" checked={mode === id} onChange={() => setMode(id)} />
                  <span>
                    <span className="font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {mode === 'transfer' && (
              <div className="space-y-2">
                {data.operators.length === 0 && <p className="text-xs text-red-500">В компании нет других действующих операторов.</p>}
                {rows.map((r) => (
                  <div key={r.key} className="flex items-center gap-2">
                    <select
                      value={r.userId}
                      onChange={(e) => setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, userId: e.target.value } : x)))}
                      className={cn(SELECT, 'flex-1 min-w-0')}
                    >
                      <option value="">Кому…</option>
                      {data.operators.map((o) => (
                        <option key={o.id} value={o.id} disabled={rows.some((x) => x.key !== r.key && x.userId === o.id)}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    {rows.length > 1 && (
                      <>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={r.weight}
                          onChange={(e) => {
                            const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
                            setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, weight: v } : x)));
                          }}
                          className={cn(SELECT, 'w-16 text-right tabular-nums')}
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                        <button type="button" onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))} className="p-1 text-muted-foreground hover:text-red-500" aria-label="Убрать">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs">
                  {rows.length < data.operators.length ? (
                    <button
                      type="button"
                      onClick={() => setRows((prev) => [...prev.map((x) => (prev.length === 1 ? { ...x, weight: 50 } : x)), { key: ++seq, userId: '', weight: prev.length === 1 ? 50 : 0 }])}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <Plus className="w-3.5 h-3.5" /> Разделить между несколькими
                    </button>
                  ) : (
                    <span />
                  )}
                  {rows.length > 1 && (
                    <span className="flex items-center gap-3">
                      <span className={total === 100 ? 'text-muted-foreground' : 'text-red-500'}>Сумма: {total}%</span>
                      <button type="button" onClick={splitEvenly} className="text-primary hover:underline">
                        Поровну
                      </button>
                    </span>
                  )}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Новый оператор увидит всю переписку целиком, в каждом диалоге появится пометка о передаче. Кого нет в проекте — добавится в него.
            </p>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Отмена
              </Button>
              <Button disabled={!count || transferInvalid || run.isPending} onClick={() => run.mutate()}>
                {run.isPending ? 'Передаём…' : `${mode === 'transfer' ? 'Передать' : 'Снять'} ${count}${beforeRemove ? ` ${beforeRemove}` : ''}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
