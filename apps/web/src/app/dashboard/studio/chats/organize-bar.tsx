'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Check, ListChecks, NotebookPen, Pin, Plus, Star, Trash2, X } from 'lucide-react';
import {
  CHAT_STATUS_LABEL,
  ChatStatus,
  ConversationDetail,
  TAG_COLORS,
  createChatTag,
  deleteChatTag,
  chatResourceOf,
  fetchChatTags,
  setConversationNote,
  setConversationPinned,
  setConversationStage,
  setConversationFavorite,
  setConversationStatus,
  setConversationTags,
} from '@/lib/chat';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { canManageChatOperators } from '@/components/chat-operators-dialog';
import { FieldsPanel, useChatFields } from './fields';
import { useChatStages } from './stages';

// Полоса под шапкой переписки (2026-10-25, как в Chatterfy): избранное, статус диалога и теги лида.
export function OrganizeBar({ conversation }: { conversation: ConversationDetail }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const { data: fields } = useChatFields(conversation.projectId, chatResourceOf(conversation));
  const filled = (fields?.fields ?? []).filter((f) => {
    const v = conversation.customFields?.[f.id];
    return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
  }).length;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['chat-conversation', conversation.id] });
    queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
  };
  const onError = (err: unknown) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить');

  const favorite = useMutation({
    mutationFn: () => setConversationFavorite(conversation.id, !conversation.favorite),
    onSuccess: refresh,
    onError,
  });
  const { data: stagesData } = useChatStages(conversation.projectId, chatResourceOf(conversation));
  const stageMut = useMutation({
    mutationFn: (stageId: string | null) => setConversationStage(conversation.id, stageId),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['chat-messages', conversation.id] });
      queryClient.invalidateQueries({ queryKey: ['chat-stages', conversation.projectId] });
    },
    onError,
  });
  const pin = useMutation({
    mutationFn: () => setConversationPinned(conversation.id, !conversation.pinned),
    onSuccess: refresh,
    onError,
  });
  const status = useMutation({
    mutationFn: (s: ChatStatus) => setConversationStatus(conversation.id, s),
    onSuccess: refresh,
    onError,
  });
  const tags = useMutation({
    mutationFn: (tagIds: string[]) => setConversationTags(conversation.id, tagIds),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['chat-tags', conversation.projectId] });
    },
    onError,
  });

  return (
    <>
    <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-[#DCE1E8] dark:border-white/10">
      <button
        type="button"
        onClick={() => favorite.mutate()}
        disabled={favorite.isPending}
        title={conversation.favorite ? 'Убрать из избранного' : 'В избранное'}
        className="p-1 rounded-md hover:bg-[#F3F5F8] dark:hover:bg-white/5"
      >
        <Star className={cn('w-4 h-4', conversation.favorite ? 'fill-amber-400 text-amber-400' : 'text-[#5F6B7A] dark:text-[#92A0AF]')} />
      </button>
      <button
        type="button"
        onClick={() => pin.mutate()}
        disabled={pin.isPending}
        title={conversation.pinned ? 'Открепить' : 'Закрепить наверху списка'}
        className={cn('p-1 rounded-md', conversation.pinned ? 'bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/10' : 'hover:bg-[#F3F5F8] dark:hover:bg-white/5')}
      >
        <Pin className={cn('w-4 h-4 -rotate-45', conversation.pinned ? 'fill-[#1F4E9C] text-[#1F4E9C] dark:fill-[#7BA9EE] dark:text-[#7BA9EE]' : 'text-[#5F6B7A] dark:text-[#92A0AF]')} />
      </button>
      {!!stagesData?.stages.length && (
        <select
          value={conversation.stageId ?? ''}
          disabled={stageMut.isPending}
          onChange={(e) => {
            const next = stagesData.stages.find((st) => st.id === e.target.value);
            if (next && !confirm(`Перевести лида на этап «${next.name}»?${next.operators.length ? ' Диалог уйдёт оператору этого этапа.' : ''}`)) return;
            stageMut.mutate(e.target.value || null);
          }}
          className="h-7 max-w-[150px] rounded-lg px-2 text-xs font-medium outline-none border border-[#DCE1E8] dark:border-white/10 bg-white dark:bg-[#171F2B] text-[#131A24] dark:text-[#E9EDF3]"
          style={(() => {
            const st = stagesData.stages.find((x) => x.id === conversation.stageId);
            return st ? { borderColor: `${st.color}80`, color: st.color } : undefined;
          })()}
          title="Этап лида"
        >
          <option value="">Без этапа</option>
          {stagesData.stages.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </select>
      )}
      <select
        value={conversation.status}
        disabled={status.isPending}
        onChange={(e) => status.mutate(e.target.value as ChatStatus)}
        className={cn(
          'h-7 rounded-lg px-2 text-xs font-medium outline-none border',
          conversation.status === 'OPEN' && 'border-[#DCE1E8] dark:border-white/10 bg-white dark:bg-[#171F2B] text-[#131A24] dark:text-[#E9EDF3]',
          conversation.status === 'WAITING' && 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
          conversation.status === 'FINISHED' && 'border-[#1F7A6C]/30 bg-[#1F7A6C]/10 text-[#1F7A6C] dark:text-[#6FCBBA]',
        )}
        title="Статус диалога. Новое сообщение лида возвращает диалог в работу."
      >
        {(Object.keys(CHAT_STATUS_LABEL) as ChatStatus[]).map((s) => (
          <option key={s} value={s}>
            {CHAT_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {conversation.tags.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-[11px] font-medium dark:brightness-150"
          style={{ backgroundColor: `${t.color}1A`, color: t.color }}
        >
          {t.name}
          <button
            type="button"
            onClick={() => tags.mutate(conversation.tags.filter((x) => x.id !== t.id).map((x) => x.id))}
            className="rounded-full p-0.5 hover:bg-black/10"
            aria-label={`Снять тег ${t.name}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <TagPicker conversation={conversation} onChange={(ids) => tags.mutate(ids)} />
      <button
        type="button"
        onClick={() => {
          setNoteOpen((v) => !v);
          setFieldsOpen(false);
        }}
        className={cn(
          'ml-auto inline-flex items-center gap-1 h-7 rounded-lg px-2 text-xs font-medium',
          noteOpen
            ? 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]'
            : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-[#F3F5F8] dark:hover:bg-white/5',
        )}
        title={conversation.note ? conversation.note.slice(0, 200) : 'Заметка о лиде'}
      >
        <NotebookPen className="w-3.5 h-3.5" /> Заметка
        {conversation.note && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-label="есть заметка" />}
      </button>
      {(fields?.fields.length || fields?.canManage) && (
        <button
          type="button"
          onClick={() => {
            setFieldsOpen((v) => !v);
            setNoteOpen(false);
          }}
          className={cn(
            'inline-flex items-center gap-1 h-7 rounded-lg px-2 text-xs font-medium',
            fieldsOpen
              ? 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]'
              : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-[#F3F5F8] dark:hover:bg-white/5',
          )}
          title="Свои поля лида"
        >
          <ListChecks className="w-3.5 h-3.5" /> Поля
          {fields && fields.fields.length > 0 && (
            <span className="tabular-nums opacity-70">
              {filled}/{fields.fields.length}
            </span>
          )}
        </button>
      )}
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
    {fieldsOpen && <FieldsPanel conversation={conversation} />}
    {noteOpen && <NotePanel conversation={conversation} />}
    </>
  );
}

// Заметка о лиде (2026-10-25): просто текст, общий для всех, кто ведёт диалог. Сохраняется при
// уходе из поля.
function NotePanel({ conversation }: { conversation: ConversationDetail }) {
  const queryClient = useQueryClient();
  const saved = conversation.note ?? '';
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => setDraft(saved), [saved, conversation.id]);
  const save = useMutation({
    mutationFn: () => setConversationNote(conversation.id, draft),
    onSuccess: () => {
      setError('');
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      queryClient.invalidateQueries({ queryKey: ['chat-conversation', conversation.id] });
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить'),
  });
  return (
    <div className="shrink-0 px-4 py-3 border-b border-[#DCE1E8] dark:border-white/10 bg-amber-50/60 dark:bg-amber-500/5">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== saved && save.mutate()}
        rows={4}
        maxLength={4000}
        placeholder="Заметка о лиде: договорённости, детали, что важно помнить…"
        className="w-full rounded-lg bg-white dark:bg-[#0F1620] border border-[#DCE1E8] dark:border-white/10 px-3 py-2 text-sm text-[#131A24] dark:text-[#E9EDF3] outline-none focus:ring-2 focus:ring-[#1F4E9C]/30 dark:focus:ring-[#7BA9EE]/30 resize-y"
      />
      <div className="mt-1 h-4 text-[11px] text-[#5F6B7A] dark:text-[#92A0AF]">
        {save.isPending ? 'Сохраняем…' : error ? <span className="text-red-600 dark:text-red-400">{error}</span> : justSaved ? 'Сохранено' : 'Сохраняется автоматически, видна всем, кто ведёт этот диалог'}
      </div>
    </div>
  );
}

function TagPicker({ conversation, onChange }: { conversation: ConversationDetail; onChange: (tagIds: string[]) => void }) {
  const queryClient = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canManage = canManageChatOperators(role);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const { data: projectTags } = useQuery({
    queryKey: ['chat-tags', conversation.projectId, chatResourceOf(conversation)],
    queryFn: () => fetchChatTags(conversation.projectId, chatResourceOf(conversation)),
    enabled: open,
  });

  // Закрытие по клику вне выпадающего окна.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const selected = new Set(conversation.tags.map((t) => t.id));
  const create = useMutation({
    mutationFn: () => createChatTag(conversation.projectId, chatResourceOf(conversation), name, color),
    onSuccess: (tag) => {
      setName('');
      setError('');
      queryClient.invalidateQueries({ queryKey: ['chat-tags', conversation.projectId] });
      onChange([...Array.from(selected), tag.id]);
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать'),
  });
  const remove = useMutation({
    mutationFn: (tagId: string) => deleteChatTag(conversation.projectId, tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-tags', conversation.projectId] });
      queryClient.invalidateQueries({ queryKey: ['chat-conversation', conversation.id] });
      queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось удалить'),
  });

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 h-7 rounded-lg px-2 text-xs font-medium text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-[#F3F5F8] dark:hover:bg-white/5"
      >
        <Plus className="w-3.5 h-3.5" /> Тег
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-64 rounded-xl border border-[#DCE1E8] dark:border-white/10 bg-white dark:bg-[#171F2B] shadow-lg p-2 space-y-2">
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {!projectTags && <div className="px-2 py-1.5 text-xs text-[#5F6B7A]">Загрузка…</div>}
            {projectTags?.length === 0 && <div className="px-2 py-1.5 text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Тегов пока нет — создайте первый ниже.</div>}
            {projectTags?.map((t) => {
              const on = selected.has(t.id);
              return (
                <div key={t.id} className="group flex items-center gap-1 rounded-lg hover:bg-[#F3F5F8] dark:hover:bg-white/5">
                  <button
                    type="button"
                    onClick={() => onChange(on ? Array.from(selected).filter((id) => id !== t.id) : [...Array.from(selected), t.id])}
                    className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left text-sm text-[#131A24] dark:text-[#E9EDF3]"
                  >
                    <span className="w-2.5 h-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                    <span className="truncate flex-1">{t.name}</span>
                    <span className="text-[11px] text-[#5F6B7A] dark:text-[#92A0AF] tabular-nums">{t.count}</span>
                    {on && <Check className="w-3.5 h-3.5 shrink-0 text-[#1F4E9C] dark:text-[#7BA9EE]" />}
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Удалить тег «${t.name}»? Он снимется со всех диалогов (${t.count}).`)) remove.mutate(t.id);
                      }}
                      className="p-1 mr-1 rounded opacity-0 group-hover:opacity-100 text-[#5F6B7A] hover:text-red-600"
                      aria-label={`Удалить тег ${t.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="border-t border-[#DCE1E8] dark:border-white/10 pt-2 space-y-1.5">
            <div className="flex gap-1">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) create.mutate();
                }}
                maxLength={40}
                placeholder="Новый тег"
                className="flex-1 min-w-0 h-8 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2 text-sm text-[#131A24] dark:text-[#E9EDF3] outline-none"
              />
              <button
                type="button"
                disabled={!name.trim() || create.isPending}
                onClick={() => create.mutate()}
                className="h-8 rounded-lg px-2.5 text-xs font-semibold bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] disabled:opacity-40"
              >
                Создать
              </button>
            </div>
            <div className="flex gap-1">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn('w-5 h-5 rounded-full ring-offset-1 ring-offset-white dark:ring-offset-[#171F2B]', color === c && 'ring-2 ring-[#131A24] dark:ring-white')}
                  style={{ backgroundColor: c }}
                  aria-label="Цвет тега"
                />
              ))}
            </div>
            {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
