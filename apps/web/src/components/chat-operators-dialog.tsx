'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Bot, Shuffle, User } from 'lucide-react';
import { api } from '@/lib/api';
import { ChatAccessData, fetchChatAccess } from '@/lib/chat';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';

// Кто из операторов ведёт чат каждого ресурса проекта — основной бот, дополнительные боты, личка
// (запрос пользователя 2026-10-24). Открывается из «Чатов» и из «Подключений»; оператор, которого
// ещё нет в проекте, добавляется в него при сохранении.
// 2026-10-25 (роль «Тимлид»): «Видит все чаты» — полный доступ к ресурсу; остальным операторам
// тимлид передаёт отдельные диалоги прямо из переписки. Плюс авто-распределение новых диалогов
// ресурса по долям в процентах, как в Chatterfy.
export function ChatOperatorsDialog({ projectId, initialResource, onClose, inline }: { projectId: string; initialResource?: string; onClose: () => void; inline?: boolean }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['chat-access', projectId],
    queryFn: () => fetchChatAccess(projectId),
  });
  const [resource, setResource] = useState<string | null>(initialResource ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [autoOn, setAutoOn] = useState(false);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (data && (!resource || !data.resources.some((r) => r.key === resource))) setResource(data.resources[0]?.key ?? null);
  }, [data, resource]);

  const assigned = useMemo(
    () => new Set((data?.assignments ?? []).filter((a) => a.resource === resource).map((a) => a.userId)),
    [data, resource],
  );
  const savedWeights = useMemo(
    () => Object.fromEntries((data?.autoAssign ?? []).filter((a) => a.resource === resource).map((a) => [a.userId, a.weight])) as Record<string, number>,
    [data, resource],
  );
  useEffect(() => setSelected(new Set(assigned)), [assigned]);
  useEffect(() => {
    setWeights(savedWeights);
    setAutoOn(Object.keys(savedWeights).length > 0);
  }, [savedWeights]);

  const operators = (data?.operators ?? []).filter((o) => o.isActive);
  const activeWeights = autoOn ? Object.entries(weights).filter(([, w]) => w > 0) : [];
  const total = activeWeights.reduce((sum, [, w]) => sum + w, 0);

  const accessDirty = selected.size !== assigned.size || Array.from(selected).some((id) => !assigned.has(id));
  const savedKey = JSON.stringify(Object.entries(savedWeights).sort());
  const autoDirty = JSON.stringify(activeWeights.sort()) !== savedKey;
  const autoInvalid = autoOn && (activeWeights.length === 0 || total !== 100);

  const save = useMutation({
    mutationFn: async () => {
      let latest: ChatAccessData | null = null;
      if (accessDirty) latest = (await api.put<ChatAccessData>(`/chat/projects/${projectId}/access`, { resource, userIds: Array.from(selected) })).data;
      if (autoDirty) {
        latest = (
          await api.put<ChatAccessData>(`/chat/projects/${projectId}/auto-assign`, {
            resource,
            rules: activeWeights.map(([userId, weight]) => ({ userId, weight })),
          })
        ).data;
      }
      return latest;
    },
    onSuccess: (latest) => {
      if (latest) queryClient.setQueryData(['chat-access', projectId], latest);
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить'),
  });

  // Поровну между теми, у кого уже стоит доля, или между всеми операторами, если долей ещё нет.
  const splitEvenly = () => {
    const ids = Object.entries(weights).filter(([, w]) => w > 0).map(([id]) => id);
    const pool = ids.length ? ids : operators.map((o) => o.id);
    if (pool.length === 0) return;
    const base = Math.floor(100 / pool.length);
    setWeights(Object.fromEntries(pool.map((id, i) => [id, base + (i < 100 - base * pool.length ? 1 : 0)])));
  };

  const resourceWord = resource === 'PERSONAL' ? 'аккаунта' : 'бота';

  const body = (
    <>        {!data ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : data.resources.length === 0 ? (
          <p className="text-sm text-muted-foreground">У проекта нет ботов и лички — назначать некуда.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {data.resources.map((r) => {
                const Icon = r.kind === 'PERSONAL' ? User : Bot;
                const count = data.assignments.filter((a) => a.resource === r.key).length;
                const auto = data.autoAssign.some((a) => a.resource === r.key);
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setResource(r.key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors',
                      resource === r.key ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-input hover:bg-muted',
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {r.title}
                    {r.kind === 'EXTRA_BOT' && <span className="text-[10px] opacity-70">доп.</span>}
                    <span className="text-xs opacity-70">· {count}</span>
                    {auto && <Shuffle className="w-3 h-3 opacity-70" aria-label="Авто-распределение включено" />}
                  </button>
                );
              })}
            </div>

            {operators.length === 0 ? (
              <p className="text-sm text-muted-foreground">В компании нет операторов — добавьте их в «Команде».</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Раздавать новые чаты автоматически</div>
                    <div className="text-xs text-muted-foreground">
                      Каждый новый диалог этого {resourceWord} сразу получает ответственного по долям ниже.
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoOn}
                    onClick={() => setAutoOn((v) => !v)}
                    className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', autoOn ? 'bg-primary' : 'bg-muted')}
                  >
                    <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', autoOn ? 'left-[22px]' : 'left-0.5')} />
                  </button>
                </div>

                <div className="max-h-80 overflow-y-auto divide-y rounded-lg border">
                  <div className="flex items-center gap-3 px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40">
                    <span className="w-4" />
                    <span className="flex-1">Оператор</span>
                    <span className="w-24 text-center">Видит все чаты</span>
                    {autoOn && <span className="w-20 text-right">Доля новых</span>}
                  </div>
                  {operators.map((op) => (
                    <div key={op.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="w-4" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{op.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {op.email}
                          {!op.onProject && <span className="text-amber-600 dark:text-amber-400"> · добавится в проект</span>}
                        </div>
                      </div>
                      <div className="w-24 flex justify-center">
                        <Checkbox
                          checked={selected.has(op.id)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selected);
                            if (checked) next.add(op.id);
                            else next.delete(op.id);
                            setSelected(next);
                          }}
                        />
                      </div>
                      {autoOn && (
                        <div className="w-20 flex items-center justify-end gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={weights[op.id] ?? 0}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
                              setWeights((prev) => ({ ...prev, [op.id]: v }));
                            }}
                            className="h-8 w-14 rounded-md border border-input bg-transparent px-2 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-primary/30"
                          />
                          <span className="text-xs text-muted-foreground">%</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {autoOn && (
                  <div className="flex items-center justify-between text-xs">
                    <span className={cn(total === 100 ? 'text-muted-foreground' : 'text-red-500')}>
                      Сумма долей: {total}%{total !== 100 && ' — должно быть 100%'}
                    </span>
                    <button type="button" onClick={splitEvenly} className="text-primary hover:underline">
                      Поровну
                    </button>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  «Видит все чаты» — оператор видит всю переписку этого {resourceWord} и может отвечать. Остальным операторам тимлид передаёт
                  отдельные диалоги прямо в чате (поле «Ответственный» в шапке переписки). Владелец, админы и тимлид проекта видят все чаты
                  всегда.
                </p>
              </>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Закрыть
              </Button>
              <Button disabled={(!accessDirty && !autoDirty) || autoInvalid || save.isPending || !resource} onClick={() => save.mutate()}>
                {save.isPending ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </div>
        )}
    </>
  );
  // Встроенный режим (2026-10-25) — вкладка в полосе над чатами вместо всплывающего окна.
  if (inline) {
    return (
      <div className="rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-5 max-w-2xl mx-auto">
        <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-4">Операторы чатов</h2>
        {body}
      </div>
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Операторы чатов</DialogTitle>
        </DialogHeader>
        {body}      </DialogContent>
    </Dialog>
  );
}

// Кто может назначать операторов на чаты — те же роли, что управляют операторами проекта
// (OPERATOR_ADMIN — «Тимлид» в интерфейсе с 2026-10-25).
export function canManageChatOperators(role: string | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'OPERATOR_ADMIN';
}
