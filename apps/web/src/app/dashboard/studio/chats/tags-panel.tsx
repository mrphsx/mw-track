'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { TAG_COLORS, createChatTag, deleteChatTag, fetchChatTags, updateChatTag } from '@/lib/chat';
import { cn } from '@/lib/utils';

// Справочник тегов проекта (2026-10-25) — вкладка «Теги» в полосе над чатами: создать, переименовать,
// перекрасить, удалить. Ставят теги прямо в переписке.
export function TagsPanel({ projectId, resource }: { projectId: string; resource: string }) {
  const queryClient = useQueryClient();
  const { data: tags } = useQuery({ queryKey: ['chat-tags', projectId, resource], queryFn: () => fetchChatTags(projectId, resource) });
  const [name, setName] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [error, setError] = useState('');
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['chat-tags', projectId] });
    queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
    queryClient.invalidateQueries({ queryKey: ['chat-conversation'] });
  };
  const onError = (err: unknown) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить');
  const create = useMutation({
    mutationFn: () => createChatTag(projectId, resource, name.trim(), color),
    onSuccess: () => {
      setName('');
      setError('');
      refresh();
    },
    onError,
  });
  const update = useMutation({ mutationFn: (v: { id: string; name?: string; color?: string }) => updateChatTag(projectId, v.id, v), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (id: string) => deleteChatTag(projectId, id), onSuccess: refresh, onError });

  return (
    <div className="rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-5 max-w-2xl mx-auto space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3]">Теги лидов</h2>
        <p className="mt-1 text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Ставятся в переписке кнопкой «+ Тег», по ним фильтруется список диалогов и срабатывают этапы.</p>
      </div>
      <div className="divide-y divide-[#DCE1E8] dark:divide-white/10 rounded-lg border border-[#DCE1E8] dark:border-white/10">
        {tags?.length === 0 && <div className="p-4 text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Тегов пока нет</div>}
        {tags?.map((t) => (
          <div key={t.id} className="group flex items-center gap-3 px-3 py-2.5">
            <span className="rounded-full px-2.5 py-0.5 text-xs font-medium dark:brightness-150" style={{ backgroundColor: `${t.color}1A`, color: t.color }}>
              {t.name}
            </span>
            <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] tabular-nums">{t.count} диал.</span>
            <div className="ml-auto flex items-center gap-1">
              <div className="hidden group-hover:flex gap-1 mr-2">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => update.mutate({ id: t.id, color: c })}
                    className={cn('w-4 h-4 rounded-full', t.color === c && 'ring-2 ring-offset-1 ring-[#131A24] dark:ring-white ring-offset-white dark:ring-offset-[#171F2B]')}
                    style={{ backgroundColor: c }}
                    aria-label="Цвет"
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  const n = prompt('Название тега', t.name);
                  if (n?.trim()) update.mutate({ id: t.id, name: n.trim() });
                }}
                className="p-1 rounded text-[#5F6B7A] hover:text-[#1F4E9C] dark:hover:text-[#7BA9EE]"
                aria-label="Переименовать"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => confirm(`Удалить тег «${t.name}»? Он снимется со всех диалогов (${t.count}).`) && remove.mutate(t.id)}
                className="p-1 rounded text-[#5F6B7A] hover:text-red-600"
                aria-label="Удалить"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && create.mutate()}
          maxLength={40}
          placeholder="Новый тег"
          className="h-9 flex-1 min-w-[160px] rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-3 text-sm text-[#131A24] dark:text-[#E9EDF3] outline-none"
        />
        <div className="flex gap-1">
          {TAG_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cn('w-5 h-5 rounded-full', color === c && 'ring-2 ring-offset-1 ring-[#131A24] dark:ring-white ring-offset-white dark:ring-offset-[#171F2B]')}
              style={{ backgroundColor: c }}
              aria-label="Цвет тега"
            />
          ))}
        </div>
        <button
          type="button"
          disabled={!name.trim() || create.isPending}
          onClick={() => create.mutate()}
          className="h-9 px-3 rounded-lg text-sm font-semibold bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] disabled:opacity-40 inline-flex items-center gap-1"
        >
          <Plus className="w-4 h-4" /> Добавить
        </button>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
