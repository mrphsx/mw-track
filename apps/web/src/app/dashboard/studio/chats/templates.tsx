'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Mic, Search, Video, Image as ImageIcon, CircleDot } from 'lucide-react';
import { ChatTemplate, ChatTemplateFolder, TEMPLATE_KIND_LABEL, TemplateMediaKind, fetchChatTemplates } from '@/lib/chat';
import { cn } from '@/lib/utils';

// Шаблоны ответов в чате (2026-10-25, как в Chatterfy): папки → шаблоны, вызов кнопкой или «#код»
// прямо в поле ввода.

export function useChatTemplates(projectId: string, resource: string) {
  return useQuery({
    queryKey: ['chat-templates', projectId, resource],
    queryFn: () => fetchChatTemplates(projectId, resource),
    staleTime: 60_000,
  });
}

const KIND_ICON: Record<TemplateMediaKind, typeof FileText> = {
  photo: ImageIcon,
  video: Video,
  document: FileText,
  voice: Mic,
  video_note: CircleDot,
};

export function TemplateKindBadge({ kind }: { kind: TemplateMediaKind | null }) {
  if (!kind) return null;
  const Icon = KIND_ICON[kind];
  return (
    <span className="inline-flex items-center gap-0.5 rounded px-1 py-px text-[10px] font-medium bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]">
      <Icon className="w-3 h-3" /> {TEMPLATE_KIND_LABEL[kind]}
    </span>
  );
}

// Совпадения для «#код» в поле ввода — по коду и названию.
export function matchTemplates(folders: ChatTemplateFolder[] | undefined, query: string): ChatTemplate[] {
  const q = query.toLowerCase();
  const all = (folders ?? []).flatMap((f) => f.templates);
  return all
    .filter((t) => t.code.toLowerCase().startsWith(q) || t.title.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.code.toLowerCase().startsWith(q)) - Number(!b.code.toLowerCase().startsWith(q)))
    .slice(0, 8);
}

// Выпадающая панель над полем ввода: папки, поиск, список шаблонов.
export function TemplatePicker({
  projectId,
  resource,
  onPick,
  onClose,
}: {
  projectId: string;
  resource: string;
  onPick: (t: ChatTemplate) => void;
  onClose: () => void;
}) {
  const { data } = useChatTemplates(projectId, resource);
  const [folderId, setFolderId] = useState<string | 'all'>('all');
  const [query, setQuery] = useState('');
  const folders = data?.folders ?? [];
  const visible = useMemo(() => {
    const list = folderId === 'all' ? folders.flatMap((f) => f.templates) : folders.find((f) => f.id === folderId)?.templates ?? [];
    const q = query.trim().toLowerCase();
    return q ? list.filter((t) => t.code.toLowerCase().includes(q) || t.title.toLowerCase().includes(q) || t.text?.toLowerCase().includes(q)) : list;
  }, [folders, folderId, query]);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-30 rounded-xl border border-[#DCE1E8] dark:border-white/10 bg-white dark:bg-[#171F2B] shadow-lg">
      <div className="flex items-center gap-2 p-2 border-b border-[#DCE1E8] dark:border-white/10">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5F6B7A]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            placeholder="Поиск шаблона"
            className="w-full h-8 pl-8 pr-2 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] text-sm text-[#131A24] dark:text-[#E9EDF3] outline-none"
          />
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto px-2 pt-2 [scrollbar-width:none]">
        {[{ id: 'all', name: 'Все' }, ...folders].map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFolderId(f.id)}
            className={cn(
              'shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium',
              folderId === f.id
                ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                : 'bg-[#F3F5F8] dark:bg-[#0F1620] text-[#5F6B7A] dark:text-[#92A0AF]',
            )}
          >
            {f.name}
          </button>
        ))}
      </div>
      <div className="max-h-64 overflow-y-auto p-1.5">
        {!data && <div className="p-3 text-xs text-[#5F6B7A]">Загрузка…</div>}
        {data && visible.length === 0 && (
          <div className="p-3 text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
            {folders.length === 0 ? 'Шаблонов пока нет — их добавляют в правой колонке чата («Шаблоны»).' : 'Ничего не найдено'}
          </div>
        )}
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t)}
            className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-[#F3F5F8] dark:hover:bg-white/5"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-[#1F4E9C] dark:text-[#7BA9EE]">#{t.code}</span>
              <span className="text-sm font-medium text-[#131A24] dark:text-[#E9EDF3] truncate">{t.title}</span>
              <TemplateKindBadge kind={t.mediaKind} />
            </div>
            {t.text && <div className="mt-0.5 text-xs text-[#5F6B7A] dark:text-[#92A0AF] line-clamp-2">{t.text}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
