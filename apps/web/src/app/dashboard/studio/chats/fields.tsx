'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ExternalLink, Plus, Settings2, Trash2 } from 'lucide-react';
import {
  CHAT_FIELD_TYPE_LABEL,
  ChatField,
  ChatFieldType,
  ConversationDetail,
  createChatField,
  deleteChatField,
  fetchChatFields,
  chatResourceOf,
  setChatFieldValues,
  updateChatField,
} from '@/lib/chat';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Свои поля лида (2026-10-25, как «кастомные поля» в Chatterfy).

export function useChatFields(projectId: string, resource: string) {
  return useQuery({
    queryKey: ['chat-fields', projectId, resource],
    queryFn: () => fetchChatFields(projectId, resource),
    staleTime: 60_000,
  });
}

const INPUT =
  'w-full h-8 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2 text-sm text-[#131A24] dark:text-[#E9EDF3] outline-none focus:ring-2 focus:ring-[#1F4E9C]/30 dark:focus:ring-[#7BA9EE]/30';

// Панель под шапкой переписки: значения полей, сохраняются при уходе из поля / выборе варианта.
export function FieldsPanel({ conversation }: { conversation: ConversationDetail }) {
  const queryClient = useQueryClient();
  const { data } = useChatFields(conversation.projectId, chatResourceOf(conversation));
  const [managerOpen, setManagerOpen] = useState(false);
  const [error, setError] = useState('');
  const values = conversation.customFields ?? {};

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => setChatFieldValues(conversation.id, patch),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['chat-conversation', conversation.id] });
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить'),
  });

  return (
    <div className="shrink-0 px-4 py-3 border-b border-[#DCE1E8] dark:border-white/10 bg-white/60 dark:bg-[#171F2B]/60 max-h-[45vh] overflow-y-auto">
      {!data ? (
        <div className="text-xs text-[#5F6B7A]">Загрузка…</div>
      ) : data.fields.length === 0 ? (
        <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
          {data.canManage ? 'Полей пока нет.' : 'Полей пока нет — их настраивает тимлид или админ.'}
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {data.fields.map((f) => (
            <label key={f.id} className={cn('block space-y-1', f.type === 'LONG_TEXT' && 'sm:col-span-2')}>
              <span className="text-[11px] font-medium text-[#5F6B7A] dark:text-[#92A0AF]">{f.name}</span>
              <FieldInput field={f} value={values[f.id]} onSave={(v) => save.mutate({ [f.id]: v })} />
            </label>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3">
        {data?.canManage && (
          <button type="button" onClick={() => setManagerOpen(true)} className="inline-flex items-center gap-1 text-xs text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline">
            <Settings2 className="w-3.5 h-3.5" /> Настроить поля
          </button>
        )}
        {save.isPending && <span className="text-xs text-[#5F6B7A]">Сохраняем…</span>}
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </div>
      {managerOpen && data && <FieldsManager projectId={conversation.projectId} resource={chatResourceOf(conversation)} fields={data.fields} onClose={() => setManagerOpen(false)} />}
    </div>
  );
}

function FieldInput({ field, value, onSave }: { field: ChatField; value: unknown; onSave: (v: unknown) => void }) {
  const initial = value === undefined || value === null ? '' : Array.isArray(value) ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const commit = () => {
    if (draft === initial) return;
    onSave(draft.trim() === '' ? null : field.type === 'NUMBER' ? draft : draft);
  };

  switch (field.type) {
    case 'SELECT':
      return (
        <select value={initial} onChange={(e) => onSave(e.target.value || null)} className={INPUT}>
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'MULTISELECT': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1">
          {field.options.map((o) => {
            const on = selected.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => onSave(on ? selected.filter((x) => x !== o) : [...selected, o])}
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs border',
                  on
                    ? 'bg-[#1F4E9C] border-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:border-[#7BA9EE] dark:text-[#0F1620]'
                    : 'border-[#DCE1E8] dark:border-white/15 text-[#5F6B7A] dark:text-[#92A0AF]',
                )}
              >
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    case 'LONG_TEXT':
      return <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} rows={3} maxLength={4000} className={cn(INPUT, 'h-auto py-1.5 resize-y')} />;
    case 'DATE':
      return <input type="date" value={draft} onChange={(e) => onSave(e.target.value || null)} className={INPUT} />;
    case 'NUMBER':
      return (
        <input
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={cn(INPUT, 'tabular-nums')}
        />
      );
    case 'LINK':
      return (
        <div className="flex gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder="https://"
            className={INPUT}
          />
          {initial && (
            <a href={initial} target="_blank" rel="noopener noreferrer" className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-[#1F4E9C] dark:text-[#7BA9EE] hover:bg-[#F3F5F8] dark:hover:bg-white/5">
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      );
    default:
      return (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          maxLength={500}
          className={INPUT}
        />
      );
  }
}

// Окно настройки полей проекта.
export function FieldsManager({ projectId, resource, fields, onClose, inline }: { projectId: string; resource: string; fields: ChatField[]; onClose: () => void; inline?: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<ChatFieldType>('TEXT');
  const [options, setOptions] = useState('');
  const [error, setError] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['chat-fields', projectId] });
  const onError = (err: unknown) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить');
  const withOptions = type === 'SELECT' || type === 'MULTISELECT';
  const parseOptions = (raw: string) => raw.split(/\n|,/).map((o) => o.trim()).filter(Boolean);

  const create = useMutation({
    mutationFn: () => createChatField(projectId, resource, { name, type, options: withOptions ? parseOptions(options) : undefined }),
    onSuccess: () => {
      setName('');
      setOptions('');
      setError('');
      refresh();
    },
    onError,
  });
  const update = useMutation({ mutationFn: (v: { id: string; name?: string; options?: string[] }) => updateChatField(projectId, v.id, v), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (id: string) => deleteChatField(projectId, id), onSuccess: refresh, onError });

  const body = (
    <>        <div className="space-y-4">
          <div className="divide-y rounded-lg border max-h-72 overflow-y-auto">
            {fields.length === 0 && <div className="p-3 text-sm text-muted-foreground">Полей пока нет</div>}
            {fields.map((f) => (
              <div key={f.id} className="flex items-start gap-2 p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{f.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {CHAT_FIELD_TYPE_LABEL[f.type]}
                    {f.options.length > 0 && `: ${f.options.join(', ')}`}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => {
                    const n = prompt('Название поля', f.name);
                    if (n === null) return;
                    const opts = f.options.length ? prompt('Варианты через запятую', f.options.join(', ')) : null;
                    update.mutate({ id: f.id, name: n, ...(opts !== null && f.options.length ? { options: parseOptions(opts) } : {}) });
                  }}
                >
                  Изменить
                </button>
                <button
                  type="button"
                  className="p-1 rounded hover:bg-muted hover:text-red-600"
                  onClick={() => confirm(`Удалить поле «${f.name}»? Его значения перестанут показываться.`) && remove.mutate(f.id)}
                  aria-label="Удалить поле"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-sm font-medium">Новое поле</div>
            <div className="grid grid-cols-[1fr_170px] gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: ID в казино"
                maxLength={60}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none"
              />
              <select value={type} onChange={(e) => setType(e.target.value as ChatFieldType)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none">
                {(Object.keys(CHAT_FIELD_TYPE_LABEL) as ChatFieldType[]).map((t) => (
                  <option key={t} value={t}>
                    {CHAT_FIELD_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            {withOptions && (
              <textarea
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                rows={3}
                placeholder="Варианты — по одному в строке или через запятую"
                className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none"
              />
            )}
            <p className="text-[11px] text-muted-foreground">Тип поля потом поменять нельзя — только название и варианты.</p>
            <div className="flex justify-end">
              <Button size="sm" disabled={!name.trim() || create.isPending || (withOptions && parseOptions(options).length === 0)} onClick={() => create.mutate()}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Добавить поле
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
    </>
  );
  // Встроенный режим (2026-10-25) — вкладка в полосе над чатами вместо всплывающего окна.
  if (inline) {
    return (
      <div className="rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-5 max-w-2xl mx-auto">
        <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-4">Поля лида</h2>
        {body}
      </div>
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Поля лида</DialogTitle>
        </DialogHeader>
        {body}      </DialogContent>
    </Dialog>
  );
}
