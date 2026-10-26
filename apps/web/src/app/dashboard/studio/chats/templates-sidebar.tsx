'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CircleDot,
  FileText,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Loader2,
  Mic,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  ChatTemplate,
  ChatTemplateFolder,
  ChatTemplateMessage,
  TemplateForm,
  TemplateMediaKind,
  TemplateMessageForm,
  createChatTemplate,
  createTemplateFolder,
  deleteChatTemplate,
  deleteTemplateFolder,
  loadTemplateMessageMedia,
  renameTemplateFolder,
  updateChatTemplate,
} from '@/lib/chat';
import { cn } from '@/lib/utils';
import { TemplateKindBadge, useChatTemplates } from './templates';

// Шаблоны ответов в правой колонке чата (запрос пользователя 2026-10-25: «в правую сторону, там
// будет либо карточка клиента, либо шаблоны ответов»): папки с названиями → ответы в них. Клик по
// ответу — вставка в поле ввода. Тимлид/админ управляют папками и ответами прямо здесь, с загрузкой
// фото, видео, кружка, голосового и документа.

// Файлы сообщений шаблона отдаются только с токеном — blob-URL, кэш на сессию по id сообщения
// (у пересохранённого шаблона сообщения получают новые id, так что старый кэш не мешает).
const mediaCache = new Map<string, Promise<string>>();
function messageMediaUrl(id: string): Promise<string> {
  let p = mediaCache.get(id);
  if (!p) {
    p = loadTemplateMessageMedia(id);
    p.catch(() => mediaCache.delete(id));
    mediaCache.set(id, p);
  }
  return p;
}

function MediaPreview({ message, compact }: { message: ChatTemplateMessage; compact?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const kind = message.mediaKind;
  useEffect(() => {
    if (!kind || kind === 'document') return;
    let cancelled = false;
    messageMediaUrl(message.id).then((u) => !cancelled && setUrl(u), () => {});
    return () => {
      cancelled = true;
    };
  }, [message.id, kind]);
  if (!kind) return null;
  if (kind === 'document') {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-md bg-[#F3F5F8] dark:bg-[#0F1620] px-2 py-1 text-xs text-[#5F6B7A] dark:text-[#92A0AF] max-w-full">
        <FileText className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{message.mediaFileName ?? 'Документ'}</span>
      </div>
    );
  }
  if (kind === 'voice' && compact) {
    return (
      <div className="w-10 h-10 shrink-0 rounded-lg bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/10 flex items-center justify-center">
        <Mic className="w-4 h-4 text-[#1F4E9C] dark:text-[#7BA9EE]" />
      </div>
    );
  }
  if (!url) return <div className={cn('shrink-0 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] animate-pulse', compact ? 'w-10 h-10' : 'w-24 h-24')} />;
  if (kind === 'photo') return <img src={url} alt="" className={cn('shrink-0 rounded-lg object-cover', compact ? 'w-10 h-10' : 'max-h-36 max-w-full')} />;
  if (kind === 'video_note') return <video src={url} muted playsInline className={cn('shrink-0 rounded-full object-cover', compact ? 'w-10 h-10' : 'w-24 h-24')} controls={!compact} />;
  if (kind === 'video') return <video src={url} muted playsInline className={cn('shrink-0 rounded-lg', compact ? 'w-10 h-10 object-cover' : 'max-h-36 max-w-full')} controls={!compact} />;
  return <audio src={url} controls className="w-full" />;
}

// onPick не задан — режим управления (вкладка «Шаблоны» над чатами): клик открывает редактор ответа.
export function TemplatesSidebar({ projectId, resource, onPick }: { projectId: string; resource: string; onPick?: (t: ChatTemplate) => void }) {
  const queryClient = useQueryClient();
  const { data } = useChatTemplates(projectId, resource);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ folderId: string; template: ChatTemplate | null } | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [newFolderScope, setNewFolderScope] = useState<'project' | 'company'>('project');
  const [error, setError] = useState('');
  const initialised = useRef(false);

  const folders = data?.folders ?? [];
  const canManageAny = !!data && (data.canManageProject || data.canManageCompany);

  // Первая папка раскрыта сразу.
  useEffect(() => {
    if (!initialised.current && folders.length) {
      initialised.current = true;
      setOpen(new Set([folders[0].id]));
    }
  }, [folders]);

  useEffect(() => {
    if (data && !data.canManageProject && data.canManageCompany) setNewFolderScope('company');
  }, [data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['chat-templates'] });
  const onError = (err: unknown) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить');

  const addFolder = useMutation({
    mutationFn: (name: string) => createTemplateFolder(name, newFolderScope === 'project' ? projectId : null, resource),
    onSuccess: (f: { id: string }) => {
      setNewFolder(null);
      setError('');
      setOpen((prev) => new Set(prev).add(f.id));
      refresh();
    },
    onError,
  });
  const renameFolder = useMutation({ mutationFn: (v: { id: string; name: string }) => renameTemplateFolder(v.id, v.name), onSuccess: refresh, onError });
  const removeFolder = useMutation({ mutationFn: (id: string) => deleteTemplateFolder(id), onSuccess: refresh, onError });
  const removeTemplate = useMutation({ mutationFn: (id: string) => deleteChatTemplate(id), onSuccess: refresh, onError });

  const q = query.trim().toLowerCase();
  const filtered = (f: ChatTemplateFolder) =>
    q ? f.templates.filter((t) => t.code.toLowerCase().includes(q) || t.title.toLowerCase().includes(q) || t.text?.toLowerCase().includes(q)) : f.templates;

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (editing) {
    return (
      <TemplateEditor
        folders={folders.filter((f) => f.canEdit)}
        folderId={editing.folderId}
        template={editing.template}
        onDone={() => {
          setEditing(null);
          refresh();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 space-y-2 border-b border-[#DCE1E8] dark:border-white/10">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5F6B7A]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск ответа"
            className="w-full h-8 pl-8 pr-2 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] text-sm text-[#131A24] dark:text-[#E9EDF3] outline-none"
          />
        </div>
        {canManageAny &&
          (newFolder === null ? (
            <button
              type="button"
              onClick={() => setNewFolder('')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline"
            >
              <FolderPlus className="w-3.5 h-3.5" /> Новая папка
            </button>
          ) : (
            <div className="space-y-1.5">
              <div className="flex gap-1">
                <input
                  autoFocus
                  value={newFolder}
                  onChange={(e) => setNewFolder(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newFolder.trim()) addFolder.mutate(newFolder.trim());
                    if (e.key === 'Escape') setNewFolder(null);
                  }}
                  maxLength={60}
                  placeholder="Название папки"
                  className="flex-1 min-w-0 h-8 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2 text-sm text-[#131A24] dark:text-[#E9EDF3] outline-none"
                />
                <button
                  type="button"
                  disabled={!newFolder.trim() || addFolder.isPending}
                  onClick={() => addFolder.mutate(newFolder.trim())}
                  className="h-8 px-2.5 rounded-lg text-xs font-semibold bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] disabled:opacity-40"
                >
                  Создать
                </button>
                <button type="button" onClick={() => setNewFolder(null)} className="h-8 w-8 rounded-lg flex items-center justify-center text-[#5F6B7A] hover:bg-[#F3F5F8] dark:hover:bg-white/5" aria-label="Отмена">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {data?.canManageProject && data.canManageCompany && (
                <select
                  value={newFolderScope}
                  onChange={(e) => setNewFolderScope(e.target.value as 'project' | 'company')}
                  className="w-full h-7 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2 text-xs text-[#131A24] dark:text-[#E9EDF3] outline-none"
                >
                  <option value="project">Только для этого проекта</option>
                  <option value="company">Для всех проектов компании</option>
                </select>
              )}
            </div>
          ))}
        {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {!data && (
          <div className="p-4 flex justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-[#5F6B7A]" />
          </div>
        )}
        {data && folders.length === 0 && (
          <div className="p-4 text-center text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
            {canManageAny ? 'Создайте папку и добавьте в неё ответы.' : 'Шаблонов пока нет — их добавляет тимлид или админ.'}
          </div>
        )}
        {folders.map((f) => {
          const items = filtered(f);
          if (q && items.length === 0) return null;
          const isOpen = !!q || open.has(f.id);
          return (
            <div key={f.id} className="rounded-lg">
              <div className="group flex items-center gap-1 rounded-lg px-1.5 py-1.5 hover:bg-[#F3F5F8] dark:hover:bg-white/5">
                <button type="button" onClick={() => toggle(f.id)} className="flex-1 min-w-0 flex items-center gap-1.5 text-left">
                  {isOpen ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-[#5F6B7A]" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[#5F6B7A]" />}
                  <Folder className="w-4 h-4 shrink-0 text-[#1F4E9C] dark:text-[#7BA9EE]" />
                  <span className="truncate text-sm font-medium text-[#131A24] dark:text-[#E9EDF3]">{f.name}</span>
                  <span className="shrink-0 text-[11px] text-[#5F6B7A] dark:text-[#92A0AF] tabular-nums">{f.templates.length}</span>
                  {!f.projectId && <span className="shrink-0 text-[10px] text-[#5F6B7A]/80 dark:text-[#92A0AF]/80">общая</span>}
                </button>
                {f.canEdit && (
                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => setEditing({ folderId: f.id, template: null })}
                      className="p-1 rounded text-[#5F6B7A] hover:text-[#1F4E9C] dark:hover:text-[#7BA9EE]"
                      title="Добавить ответ"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const name = prompt('Название папки', f.name);
                        if (name?.trim()) renameFolder.mutate({ id: f.id, name: name.trim() });
                      }}
                      className="p-1 rounded text-[#5F6B7A] hover:text-[#1F4E9C] dark:hover:text-[#7BA9EE]"
                      title="Переименовать"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => confirm(`Удалить папку «${f.name}» вместе с ${f.templates.length} ответами?`) && removeFolder.mutate(f.id)}
                      className="p-1 rounded text-[#5F6B7A] hover:text-red-600"
                      title="Удалить папку"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              {isOpen && (
                <div className="ml-3 pl-2 border-l border-[#DCE1E8] dark:border-white/10 space-y-1 py-1">
                  {items.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                      Пусто.
                      {f.canEdit && (
                        <button type="button" onClick={() => setEditing({ folderId: f.id, template: null })} className="ml-1 text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline">
                          Добавить ответ
                        </button>
                      )}
                    </div>
                  )}
                  {items.map((t) => (
                    <div key={t.id} className="group relative rounded-lg border border-transparent hover:border-[#DCE1E8] dark:hover:border-white/10 hover:bg-[#F3F5F8]/60 dark:hover:bg-white/[0.03]">
                      <button
                        type="button"
                        onClick={() => (onPick ? onPick(t) : f.canEdit && setEditing({ folderId: f.id, template: t }))}
                        className="w-full text-left p-2"
                        title={onPick ? 'Вставить в сообщение' : 'Изменить ответ'}
                      >
                        <div className="flex items-center gap-1.5 flex-wrap pr-12">
                          <span className="text-[11px] font-mono text-[#1F4E9C] dark:text-[#7BA9EE]">#{t.code}</span>
                          <span className="text-sm font-medium text-[#131A24] dark:text-[#E9EDF3] truncate">{t.title}</span>
                          {t.messages.length > 1 && (
                            <span className="rounded px-1 py-px text-[10px] font-medium bg-[#1F7A6C]/10 text-[#1F7A6C] dark:bg-[#6FCBBA]/10 dark:text-[#6FCBBA]">
                              {t.messages.length} сообщ.
                            </span>
                          )}
                        </div>
                        <div className="mt-1 space-y-1">
                          {t.messages.map((m, i) => (
                            <div key={m.id} className="flex items-start gap-2">
                              {t.messages.length > 1 && <span className="mt-0.5 w-4 shrink-0 text-[10px] text-[#5F6B7A] tabular-nums">{i + 1}.</span>}
                              {m.mediaKind && m.mediaKind !== 'document' && <MediaPreview message={m} compact />}
                              <div className="min-w-0 flex-1 space-y-0.5">
                                {m.mediaKind && <TemplateKindBadge kind={m.mediaKind} />}
                                {m.text && <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] line-clamp-2 whitespace-pre-wrap">{m.text}</div>}
                                {m.mediaKind === 'document' && <MediaPreview message={m} />}
                              </div>
                            </div>
                          ))}
                        </div>
                      </button>
                      {f.canEdit && (
                        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 dark:bg-[#171F2B]/90 rounded-md">
                          <button type="button" onClick={() => setEditing({ folderId: f.id, template: t })} className="p-1 rounded text-[#5F6B7A] hover:text-[#1F4E9C] dark:hover:text-[#7BA9EE]" title="Изменить">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => confirm(`Удалить ответ #${t.code}?`) && removeTemplate.mutate(t.id)}
                            className="p-1 rounded text-[#5F6B7A] hover:text-red-600"
                            title="Удалить"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Тип файла в сообщении: фото/видео распознаются сами, кружок/голосовое/документ — явным выбором.
const UPLOADS: { kind: '' | TemplateMediaKind; label: string; icon: typeof ImageIcon; accept: string }[] = [
  { kind: '', label: 'Фото / видео', icon: ImageIcon, accept: 'image/jpeg,image/png,image/webp,video/mp4' },
  { kind: 'video_note', label: 'Кружок', icon: CircleDot, accept: 'video/*' },
  { kind: 'voice', label: 'Голосовое', icon: Mic, accept: 'audio/*,video/*,.ogg,.opus,.mp3,.m4a,.wav' },
  { kind: 'document', label: 'Документ', icon: FileText, accept: '*/*' },
];
const MAX_MESSAGES = 10;
let rowSeq = 0;
const newRow = (m?: ChatTemplateMessage): TemplateMessageForm => ({
  key: `r${++rowSeq}`,
  id: m?.id,
  text: m?.text ?? '',
  mediaKind: '',
  keepMedia: !!m?.mediaKind,
  existing: m,
  file: null,
});

function TemplateEditor({
  folders,
  folderId,
  template,
  onDone,
}: {
  folders: ChatTemplateFolder[];
  folderId: string;
  template: ChatTemplate | null;
  onDone: () => void;
}) {
  const [form, setForm] = useState<TemplateForm>(() => ({
    folderId,
    code: template?.code ?? '',
    title: template?.title ?? '',
    messages: template?.messages.length ? template.messages.map((m) => newRow(m)) : [newRow()],
  }));
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => (template ? updateChatTemplate(template.id, form) : createChatTemplate(form)),
    onSuccess: onDone,
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить'),
  });

  const setMsg = (key: string, patch: Partial<TemplateMessageForm>) =>
    setForm((prev) => ({ ...prev, messages: prev.messages.map((m) => (m.key === key ? { ...m, ...patch } : m)) }));
  const move = (index: number, dir: -1 | 1) =>
    setForm((prev) => {
      const list = [...prev.messages];
      const [item] = list.splice(index, 1);
      list.splice(index + dir, 0, item);
      return { ...prev, messages: list };
    });
  const hasContent = (m: TemplateMessageForm) => !!m.text.trim() || !!m.file || (m.keepMedia && !!m.existing?.mediaKind);
  const valid = !!form.code && form.messages.length > 0 && form.messages.every(hasContent);
  const converting = form.messages.some((m) => m.file && (m.mediaKind === 'video_note' || m.mediaKind === 'voice'));

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 h-11 shrink-0 border-b border-[#DCE1E8] dark:border-white/10">
        <span className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">{template ? 'Изменить ответ' : 'Новый ответ'}</span>
        <button type="button" onClick={onDone} className="p-1 rounded text-[#5F6B7A] hover:bg-[#F3F5F8] dark:hover:bg-white/5" aria-label="Закрыть">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 text-sm">
        <label className="block space-y-1">
          <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Папка</span>
          <select
            value={form.folderId}
            onChange={(e) => setForm((prev) => ({ ...prev, folderId: e.target.value }))}
            className="w-full h-8 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2 text-[#131A24] dark:text-[#E9EDF3] outline-none"
          >
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-[110px_1fr] gap-2">
          <label className="space-y-1">
            <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Код (#)</span>
            <input
              value={form.code}
              onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.replace(/\s/g, '').replace(/^#/, '') }))}
              placeholder="депозит"
              maxLength={32}
              className="w-full h-8 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2 font-mono text-[#131A24] dark:text-[#E9EDF3] outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Название</span>
            <input
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Как внести депозит"
              maxLength={80}
              className="w-full h-8 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2 text-[#131A24] dark:text-[#E9EDF3] outline-none"
            />
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#5F6B7A] dark:text-[#92A0AF]">Сообщения — уйдут по порядку</span>
            <span className="text-[11px] text-[#5F6B7A] tabular-nums">
              {form.messages.length}/{MAX_MESSAGES}
            </span>
          </div>
          {form.messages.map((m, i) => (
            <MessageBlock
              key={m.key}
              index={i}
              total={form.messages.length}
              message={m}
              onChange={(patch) => setMsg(m.key, patch)}
              onMove={(dir) => move(i, dir)}
              onRemove={() => setForm((prev) => ({ ...prev, messages: prev.messages.filter((x) => x.key !== m.key) }))}
              onError={setError}
            />
          ))}
          {form.messages.length < MAX_MESSAGES && (
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, messages: [...prev.messages, newRow()] }))}
              className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed border-[#DCE1E8] dark:border-white/15 text-xs font-medium text-[#1F4E9C] dark:text-[#7BA9EE] hover:border-[#1F4E9C] dark:hover:border-[#7BA9EE]"
            >
              <Plus className="w-3.5 h-3.5" /> Добавить сообщение
            </button>
          )}
        </div>
        {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
      </div>
      <div className="shrink-0 flex justify-end gap-2 p-3 border-t border-[#DCE1E8] dark:border-white/10">
        <button type="button" onClick={onDone} className="h-8 px-3 rounded-lg text-xs text-[#5F6B7A] hover:bg-[#F3F5F8] dark:hover:bg-white/5">
          Отмена
        </button>
        <button
          type="button"
          disabled={!valid || save.isPending}
          onClick={() => save.mutate()}
          className="h-8 px-3 rounded-lg text-xs font-semibold bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {save.isPending && converting ? 'Обрабатываем файлы…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

function MessageBlock({
  index,
  total,
  message,
  onChange,
  onMove,
  onRemove,
  onError,
}: {
  index: number;
  total: number;
  message: TemplateMessageForm;
  onChange: (patch: Partial<TemplateMessageForm>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onError: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingKind, setPendingKind] = useState<'' | TemplateMediaKind>('');
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!message.file) return setPreview(null);
    const url = URL.createObjectURL(message.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [message.file]);

  const showExisting = !message.file && message.keepMedia && message.existing?.mediaKind;
  const kindLabel = message.mediaKind === 'video_note' ? 'Кружок' : message.mediaKind === 'voice' ? 'Голосовое' : message.mediaKind === 'document' ? 'Документ' : 'Фото / видео';

  return (
    <div className="rounded-lg border border-[#DCE1E8] dark:border-white/10 p-2 space-y-2">
      <div className="flex items-center gap-1">
        <span className="text-xs font-semibold text-[#131A24] dark:text-[#E9EDF3]">Сообщение {index + 1}</span>
        <div className="ml-auto flex items-center">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="p-1 rounded text-[#5F6B7A] disabled:opacity-30 hover:text-[#1F4E9C]" aria-label="Выше">
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" disabled={index === total - 1} onClick={() => onMove(1)} className="p-1 rounded text-[#5F6B7A] disabled:opacity-30 hover:text-[#1F4E9C]" aria-label="Ниже">
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          {total > 1 && (
            <button type="button" onClick={onRemove} className="p-1 rounded text-[#5F6B7A] hover:text-red-600" aria-label="Убрать сообщение">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <textarea
        value={message.text}
        onChange={(e) => onChange({ text: e.target.value })}
        rows={3}
        maxLength={4096}
        placeholder={index === 0 ? 'Текст сообщения (можно без текста, если есть файл)' : 'Текст или подпись к файлу'}
        className="w-full rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2 py-1.5 text-[#131A24] dark:text-[#E9EDF3] outline-none resize-y"
      />
      {showExisting && message.existing && (
        <div className="space-y-1.5">
          <MediaPreview message={message.existing} />
          <button type="button" onClick={() => onChange({ keepMedia: false })} className="text-xs text-red-600 hover:underline">
            Убрать файл
          </button>
        </div>
      )}
      {message.file && (
        <div className="space-y-1.5 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] p-2">
          <div className="flex items-center gap-2 text-xs text-[#131A24] dark:text-[#E9EDF3]">
            <span className="font-medium">{kindLabel}:</span>
            <span className="truncate flex-1">{message.file.name}</span>
            <button type="button" onClick={() => onChange({ file: null, mediaKind: '' })} className="text-[#5F6B7A] hover:text-red-600" aria-label="Убрать файл">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {preview && message.file.type.startsWith('image/') && message.mediaKind !== 'document' && <img src={preview} alt="" className="max-h-28 rounded-lg" />}
          {preview && message.file.type.startsWith('video/') && (message.mediaKind === '' || message.mediaKind === 'video_note') && (
            <video src={preview} muted playsInline controls className={cn(message.mediaKind === 'video_note' ? 'w-24 h-24 rounded-full object-cover' : 'max-h-28 rounded-lg')} />
          )}
          {preview && message.mediaKind === 'voice' && <audio src={preview} controls className="w-full" />}
          {message.mediaKind === 'video_note' && <p className="text-[11px] text-[#5F6B7A] dark:text-[#92A0AF]">Обрежется в квадрат до 60 секунд — получится кружок.</p>}
          {message.mediaKind === 'voice' && <p className="text-[11px] text-[#5F6B7A] dark:text-[#92A0AF]">Перекодируется в голосовое Telegram.</p>}
        </div>
      )}
      {!message.file && !showExisting && (
        <div className="grid grid-cols-2 gap-1">
          {UPLOADS.map((u) => (
            <button
              key={u.label}
              type="button"
              onClick={() => {
                setPendingKind(u.kind);
                if (fileRef.current) {
                  fileRef.current.accept = u.accept;
                  fileRef.current.click();
                }
              }}
              className="inline-flex items-center justify-center gap-1 h-8 rounded-lg border border-dashed border-[#DCE1E8] dark:border-white/15 text-[11px] text-[#5F6B7A] dark:text-[#92A0AF] hover:border-[#1F4E9C] hover:text-[#1F4E9C] dark:hover:border-[#7BA9EE] dark:hover:text-[#7BA9EE]"
            >
              <u.icon className="w-3.5 h-3.5" /> {u.label}
            </button>
          ))}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > 20 * 1024 * 1024) return onError('Файл больше 20 МБ');
          onError('');
          onChange({ file, mediaKind: pendingKind, keepMedia: false });
        }}
      />
    </div>
  );
}
