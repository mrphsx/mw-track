'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowDown, ArrowUp, Pencil, Plus, Shuffle, Trash2 } from 'lucide-react';
import {
  ChatStage,
  ChatStageTrigger,
  STAGE_TRIGGER_LABEL,
  StageInput,
  TAG_COLORS,
  applyChatStage,
  createChatStage,
  deleteChatStage,
  fetchChatAccess,
  fetchChatFields,
  fetchChatStages,
  fetchChatTags,
  reorderChatStages,
  updateChatStage,
} from '@/lib/chat';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Этапы лида (2026-10-25, по образцу флоу Chatterfy): свои этапы проекта, у каждого — операторы с
// долями; лид переходит на этап по событию (покупка, тег, поле, новый диалог) или вручную.

// resource — 'BOT' | 'BOT:<id>' | 'PERSONAL': у бота и лички свои этапы (2026-10-25).
export function useChatStages(projectId: string, resource: string) {
  return useQuery({
    queryKey: ['chat-stages', projectId, resource],
    queryFn: () => fetchChatStages(projectId, resource),
    staleTime: 60_000,
  });
}

export function triggerSummary(s: Pick<ChatStage, 'trigger' | 'purchaseNumber' | 'fieldValue'>, tagName?: string, fieldName?: string): string {
  if (s.trigger === 'REPEAT_PURCHASE') return s.purchaseNumber ? `Покупка №${s.purchaseNumber}` : 'Любая повторная покупка';
  if (s.trigger === 'TAG') return `Тег «${tagName ?? '?'}»`;
  if (s.trigger === 'FIELD') return `${fieldName ?? 'Поле'} = «${s.fieldValue ?? ''}»`;
  return STAGE_TRIGGER_LABEL[s.trigger];
}

const EMPTY: StageInput = { name: '', color: TAG_COLORS[0], trigger: 'MANUAL', purchaseNumber: null, tagId: null, fieldId: null, fieldValue: null, operators: [] };

export function StagesDialog({ projectId, resource, onClose, inline }: { projectId: string; resource: string; onClose: () => void; inline?: boolean }) {
  const queryClient = useQueryClient();
  const { data } = useChatStages(projectId, resource);
  const { data: access } = useQuery({ queryKey: ['chat-access', projectId], queryFn: () => fetchChatAccess(projectId) });
  const { data: tags } = useQuery({ queryKey: ['chat-tags', projectId, resource], queryFn: () => fetchChatTags(projectId, resource) });
  const { data: fields } = useQuery({ queryKey: ['chat-fields', projectId, resource], queryFn: () => fetchChatFields(projectId, resource) });
  const [editing, setEditing] = useState<{ id: string | null; form: StageInput } | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const stages = data?.stages ?? [];
  const operators = (access?.operators ?? []).filter((o) => o.isActive);
  const opName = (id: string) => operators.find((o) => o.id === id)?.name ?? 'оператор';
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['chat-stages', projectId] });
    queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
  };
  const onError = (err: unknown) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить');

  const save = useMutation({
    mutationFn: () => (editing!.id ? updateChatStage(projectId, editing!.id, editing!.form) : createChatStage(projectId, resource, editing!.form)),
    onSuccess: () => {
      setEditing(null);
      setError('');
      refresh();
    },
    onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => deleteChatStage(projectId, id), onSuccess: refresh, onError });
  const reorder = useMutation({ mutationFn: (ids: string[]) => reorderChatStages(projectId, resource, ids), onSuccess: refresh, onError });
  const apply = useMutation({
    mutationFn: (id: string) => applyChatStage(projectId, id),
    onSuccess: (r) => {
      setInfo(`Разложено диалогов: ${r.moved}`);
      refresh();
    },
    onError,
  });

  const move = (i: number, dir: -1 | 1) => {
    const ids = stages.map((s) => s.id);
    const [x] = ids.splice(i, 1);
    ids.splice(i + dir, 0, x);
    reorder.mutate(ids);
  };

  const form = editing?.form;
  const setForm = (patch: Partial<StageInput>) => setEditing((prev) => (prev ? { ...prev, form: { ...prev.form, ...patch } } : prev));
  const weight = (userId: string) => form?.operators.find((o) => o.userId === userId)?.weight ?? 0;
  const setWeight = (userId: string, w: number) =>
    setForm({ operators: [...(form?.operators ?? []).filter((o) => o.userId !== userId), ...(w > 0 ? [{ userId, weight: w }] : [])] });
  const total = (form?.operators ?? []).reduce((s, o) => s + o.weight, 0);
  const splitEvenly = () => {
    const pool = form?.operators.length ? form.operators.map((o) => o.userId) : operators.map((o) => o.id);
    if (!pool.length) return;
    const base = Math.floor(100 / pool.length);
    setForm({ operators: pool.map((userId, i) => ({ userId, weight: base + (i < 100 - base * pool.length ? 1 : 0) })) });
  };
  const formValid =
    !!form?.name.trim() &&
    (total === 0 || total === 100) &&
    (form.trigger !== 'TAG' || !!form.tagId) &&
    (form.trigger !== 'FIELD' || (!!form.fieldId && !!form.fieldValue?.trim()));

  const body = (
    <>
        {!editing ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Лид проходит этапы, у каждого этапа — свои операторы. Когда срабатывает условие этапа (покупка, тег, поле), диалог сам уходит
              оператору этого этапа, прежний оператор его больше не видит. Перевести можно и вручную — в шапке переписки.
            </p>
            <div className="divide-y rounded-lg border">
              {stages.length === 0 && <div className="p-4 text-sm text-muted-foreground">Этапов пока нет. Например: «Новые» → «Депозит» → «Повторные».</div>}
              {stages.map((s, i) => (
                <div key={s.id} className="flex items-start gap-3 p-3">
                  <span className="mt-1 w-3 h-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{s.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{s.count} диал.</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Условие: {triggerSummary(s, tags?.find((t) => t.id === s.tagId)?.name, fields?.fields.find((f) => f.id === s.fieldId)?.name)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.operators.length
                        ? `Операторы: ${s.operators.map((o) => `${opName(o.userId)} ${o.weight}%`).join(', ')}`
                        : 'Операторы не заданы — ответственный не меняется'}
                    </div>
                    {s.trigger !== 'MANUAL' && (
                      <button
                        type="button"
                        disabled={apply.isPending}
                        onClick={() =>
                          confirm(`Перевести на этап «${s.name}» все диалоги, которые уже подходят под условие? Они уйдут операторам этапа.`) && apply.mutate(s.id)
                        }
                        className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Shuffle className="w-3 h-3" /> Разложить уже подходящих
                      </button>
                    )}
                  </div>
                  <div className="flex items-center">
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 rounded hover:bg-muted disabled:opacity-30" aria-label="Выше">
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" disabled={i === stages.length - 1} onClick={() => move(i, 1)} className="p-1 rounded hover:bg-muted disabled:opacity-30" aria-label="Ниже">
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          id: s.id,
                          form: { name: s.name, color: s.color, trigger: s.trigger, purchaseNumber: s.purchaseNumber, tagId: s.tagId, fieldId: s.fieldId, fieldValue: s.fieldValue, operators: s.operators },
                        })
                      }
                      className="p-1 rounded hover:bg-muted"
                      aria-label="Изменить"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => confirm(`Удалить этап «${s.name}»? Диалоги останутся у своих операторов, просто без этапа.`) && remove.mutate(s.id)}
                      className="p-1 rounded hover:bg-muted hover:text-red-600"
                      aria-label="Удалить"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {info && <p className="text-sm text-[#1F7A6C] dark:text-[#6FCBBA]">{info}</p>}
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-between">
              <Button variant="outline" onClick={onClose}>
                Закрыть
              </Button>
              <Button onClick={() => setEditing({ id: null, form: { ...EMPTY, trigger: stages.length ? 'MANUAL' : 'NEW_CHAT' } })}>
                <Plus className="w-4 h-4 mr-1" /> Этап
              </Button>
            </div>
          </div>
        ) : (
          form && (
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Название</span>
                  <input
                    autoFocus
                    value={form.name}
                    onChange={(e) => setForm({ name: e.target.value })}
                    placeholder="Например: Депозит"
                    maxLength={60}
                    className="w-full h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none"
                  />
                </label>
                <div className="flex gap-1 pb-2">
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ color: c })}
                      className={cn('w-5 h-5 rounded-full ring-offset-1 ring-offset-background', form.color === c && 'ring-2 ring-foreground')}
                      style={{ backgroundColor: c }}
                      aria-label="Цвет этапа"
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Когда лид попадает на этап</span>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={form.trigger}
                    onChange={(e) => setForm({ trigger: e.target.value as ChatStageTrigger })}
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none"
                  >
                    {(Object.keys(STAGE_TRIGGER_LABEL) as ChatStageTrigger[]).map((t) => (
                      <option key={t} value={t}>
                        {STAGE_TRIGGER_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  {form.trigger === 'REPEAT_PURCHASE' && (
                    <select
                      value={form.purchaseNumber ?? ''}
                      onChange={(e) => setForm({ purchaseNumber: e.target.value ? Number(e.target.value) : null })}
                      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none"
                    >
                      <option value="">любая повторная</option>
                      {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                        <option key={n} value={n}>
                          {n}-я покупка
                        </option>
                      ))}
                    </select>
                  )}
                  {form.trigger === 'TAG' && (
                    <select
                      value={form.tagId ?? ''}
                      onChange={(e) => setForm({ tagId: e.target.value || null })}
                      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none"
                    >
                      <option value="">выберите тег…</option>
                      {tags?.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {form.trigger === 'FIELD' && (
                    <>
                      <select
                        value={form.fieldId ?? ''}
                        onChange={(e) => setForm({ fieldId: e.target.value || null, fieldValue: null })}
                        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none"
                      >
                        <option value="">выберите поле…</option>
                        {fields?.fields.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                      {(() => {
                        const f = fields?.fields.find((x) => x.id === form.fieldId);
                        if (!f) return null;
                        return f.options.length ? (
                          <select
                            value={form.fieldValue ?? ''}
                            onChange={(e) => setForm({ fieldValue: e.target.value || null })}
                            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none"
                          >
                            <option value="">значение…</option>
                            {f.options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={form.fieldValue ?? ''}
                            onChange={(e) => setForm({ fieldValue: e.target.value })}
                            placeholder="значение"
                            className="h-9 w-36 rounded-md border border-input bg-transparent px-2 text-sm outline-none"
                          />
                        );
                      })()}
                    </>
                  )}
                </div>
                {form.trigger === 'NEW_CHAT' && <p className="text-[11px] text-muted-foreground">Каждый новый диалог проекта сразу попадает на этот этап и к его операторам.</p>}
                {form.trigger === 'TAG' && !tags?.length && <p className="text-[11px] text-muted-foreground">Тегов пока нет — их создают в переписке кнопкой «+ Тег».</p>}
                {form.trigger === 'FIELD' && !fields?.fields.length && <p className="text-[11px] text-muted-foreground">Полей пока нет — их настраивают в переписке («Поля»).</p>}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Операторы этапа и доли</span>
                  <button type="button" onClick={splitEvenly} className="text-xs text-primary hover:underline">
                    Поровну
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto divide-y rounded-lg border">
                  {operators.length === 0 && <div className="p-3 text-sm text-muted-foreground">В компании нет операторов</div>}
                  {operators.map((o) => (
                    <div key={o.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{o.name}</div>
                        {!o.onProject && <div className="text-[11px] text-amber-600 dark:text-amber-400">добавится в проект</div>}
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={weight(o.id)}
                        onChange={(e) => setWeight(o.id, Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))}
                        className="h-8 w-16 rounded-md border border-input bg-transparent px-2 text-right text-sm tabular-nums outline-none"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  ))}
                </div>
                <div className={cn('text-xs', total === 0 || total === 100 ? 'text-muted-foreground' : 'text-red-500')}>
                  {total === 0 ? 'Без операторов: при переходе ответственный не меняется.' : `Сумма долей: ${total}%${total !== 100 ? ' — должно быть 100%' : ''}`}
                </div>
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(null)}>
                  Отмена
                </Button>
                <Button disabled={!formValid || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? 'Сохраняем…' : 'Сохранить'}
                </Button>
              </div>
            </div>
          )
        )}
    </>
  );
  // Встроенный режим (2026-10-25) — вкладка в полосе над чатами вместо всплывающего окна.
  if (inline) {
    return (
      <div className="rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-5 max-w-3xl mx-auto">
        <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-4">Этапы лидов</h2>
        {body}
      </div>
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Этапы лидов</DialogTitle>
        </DialogHeader>
        {body}      </DialogContent>
    </Dialog>
  );
}
