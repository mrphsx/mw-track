'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowLeft, ArrowRightLeft, BookText, Bot, CheckSquare, Copy, ChevronRight, Folder, FolderPlus, Layers, ListChecks, Megaphone, MessagesSquare, SlidersHorizontal, Star, Tag, User, UserCog, X } from 'lucide-react';
import { api } from '@/lib/api';
import {
  CHAT_SOURCE_LABEL,
  CHAT_TABS,
  ChatProject,
  ChatSource,
  ChatTab,
  ChatTemplate,
  ConversationFilters,
  assignConversations,
  chatHref,
  chatResourceOf,
  createProjectFolder,
  deleteProjectFolder,
  fetchProjectFolders,
  renameProjectFolder,
  setConversationPinned,
  setProjectFavorite,
  setProjectFolder,
  fetchChatAccess,
  fetchChatFields,
  fetchChatTags,
  fetchConversations,
  fetchTabCounts,
} from '@/lib/chat';
import { cn } from '@/lib/utils';
import { ChannelAvatar } from '@/components/channel-avatar';
import { ClientDetailContent } from '@/components/clients/client-detail-drawer';
import { STUDIO_CARD } from '../ui';
import { useAuthStore } from '@/store/auth.store';
import { ChatOperatorsDialog, canManageChatOperators } from '@/components/chat-operators-dialog';
import { ConversationList } from './conversation-list';
import { TemplatesSidebar } from './templates-sidebar';
import { StagesDialog, useChatStages } from './stages';
import { TagsPanel } from './tags-panel';
import { BroadcastDialog, BroadcastsPanel } from './broadcast';
import { DistributionBar } from './distribution-bar';
import { FieldsManager, useChatFields } from './fields';
import { Thread } from './thread';
import { CopySettingsDialog } from './copy-settings';
import { TransferChatsDialog } from '@/components/transfer-chats-dialog';

const LIST_POLL_MS = 5000;
const PROJECTS_POLL_MS = 15000;

// Встроенный чат операторов (запрос пользователя 2026-10-23). Сначала выбирается проект, затем
// открывается его чат («сделай чтобы проект выбирался сначала а потом открывался чат»). У проекта
// может быть два чата — через бота и через подключённый личный аккаунт; тогда наверху
// переключатель «Бот / Личка». Состояние — в адресе (?project=&source=&c=), чтобы ссылку можно
// было переслать коллеге и открыть с карточки проекта. Обновление — опросом, react-query сам
// останавливает его в фоновой вкладке.
export default function StudioChatsPage() {
  return (
    <Suspense>
      <ChatsInner />
    </Suspense>
  );
}

function ChatsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectId = searchParams.get('project');
  const sourceParam = searchParams.get('source');
  const conversationId = searchParams.get('c');
  const viewParam = searchParams.get('view');
  const role = useAuthStore((s) => s.user?.role);

  const { data: projects } = useQuery({
    queryKey: ['chat-projects'],
    queryFn: async () => (await api.get<ChatProject[]>('/chat/projects')).data,
    refetchInterval: PROJECTS_POLL_MS,
  });

  // Ссылка только на диалог (?c=) — достраиваем проект и источник по самому диалогу.
  const { data: orphanConversation } = useQuery({
    queryKey: ['chat-conversation', conversationId],
    queryFn: async () => (await api.get<{ projectId: string; source: ChatSource }>(`/chat/conversations/${conversationId}`)).data,
    enabled: !!conversationId && !projectId,
  });
  useEffect(() => {
    if (orphanConversation && !projectId) {
      router.replace(chatHref(orphanConversation.projectId, orphanConversation.source, conversationId ?? undefined), { scroll: false });
    }
  }, [orphanConversation, projectId, conversationId, router]);

  const project = projects?.find((p) => p.id === projectId);
  // Вкладки настроек (этапы, шаблоны, поля, теги) — у каждого ресурса проекта свои (2026-10-25:
  // «бот отдельная сущность»). Ресурс вкладки — в адресе (?res=), по умолчанию — текущий канал.
  const settingsView = viewParam === 'stages' || viewParam === 'templates' || viewParam === 'fields' || viewParam === 'tags';
  const { data: access } = useQuery({
    queryKey: ['chat-access', projectId],
    queryFn: () => fetchChatAccess(projectId!),
    enabled: !!projectId && settingsView && canManageChatOperators(role),
  });
  const [copyOpen, setCopyOpen] = useState(false);
  const source: ChatSource | null = project
    ? sourceParam === 'PERSONAL' && project.personal
      ? 'PERSONAL'
      : sourceParam === 'BOT' && project.bot
        ? 'BOT'
        : project.bot
          ? 'BOT'
          : project.personal
            ? 'PERSONAL'
            : null
    : null;

  if (!projectId) {
    return <ProjectPicker projects={projects} />;
  }
  const resources = access?.resources ?? [];
  const resParam = searchParams.get('res');
  const settingsResource = resParam && resources.some((r) => r.key === resParam) ? resParam : source === 'PERSONAL' ? 'PERSONAL' : 'BOT';
  const setSettingsResource = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('res', key);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  // Вкладки полосы над чатами (2026-10-25: «полоску поверх чатов с вкладками по центру, где можно
  // перейти к настройке, флоу и т.д.»). Настройки — тимлиду, админу, владельцу; вкладка — в адресе.
  const canManage = canManageChatOperators(role);
  const viewTabs = [
    { id: 'chats', label: 'Чаты', icon: MessagesSquare },
    ...(canManage
      ? [
          { id: 'stages', label: 'Этапы', icon: Layers },
          { id: 'templates', label: 'Шаблоны', icon: BookText },
          { id: 'fields', label: 'Поля', icon: ListChecks },
          { id: 'tags', label: 'Теги', icon: Tag },
          { id: 'operators', label: 'Операторы', icon: UserCog },
          { id: 'broadcasts', label: 'Рассылки', icon: Megaphone },
        ]
      : []),
  ];
  const view = viewTabs.some((t) => t.id === viewParam) ? viewParam! : 'chats';
  const setView = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id === 'chats') params.delete('view');
    else params.set('view', id);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  return (
    // Вкладка «Чаты» занимает ровно экран (2026-10-26: «не весь контент помещается по высоте» —
    // высота окна чата считалась без полосы «Кто ведёт лидов», и низ уезжал за экран): колонка на
    // высоту области под шапкой (100vh − шапка 4rem − нижний отступ main 2.5rem), окно чата
    // забирает остаток. Остальные вкладки — обычная прокрутка.
    <div className={view === 'chats' ? 'flex flex-col gap-4 h-[calc(100vh-6.5rem)] min-h-[560px]' : 'space-y-4'}>
      <div className={cn(STUDIO_CARD, 'shrink-0 grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2')}>
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href={pathname}
            className="shrink-0 p-1.5 rounded-lg text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-[#F3F5F8] dark:hover:bg-white/5"
            title="Все проекты"
            aria-label="Все проекты"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-base font-semibold text-[#131A24] dark:text-[#E9EDF3] truncate">{project?.name ?? 'Чат'}</h1>
        </div>

        <div className="flex justify-center overflow-x-auto [scrollbar-width:none]">
          {viewTabs.length > 1 && (
            <div className="inline-flex rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] p-1 gap-0.5">
              {viewTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setView(t.id)}
                  className={cn(
                    'shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                    view === t.id
                      ? 'bg-white text-[#131A24] shadow-sm dark:bg-[#171F2B] dark:text-[#E9EDF3]'
                      : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]',
                  )}
                >
                  <t.icon className="w-4 h-4" />
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {settingsView && view === viewParam && resources.length > 1 && (
            <div className="inline-flex flex-wrap rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] p-1 gap-0.5">
              {resources.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setSettingsResource(r.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                    settingsResource === r.key
                      ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                      : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]',
                  )}
                >
                  {r.kind === 'PERSONAL' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  {r.kind === 'PERSONAL' ? 'Личка' : r.kind === 'EXTRA_BOT' ? r.title : 'Бот'}
                </button>
              ))}
            </div>
          )}
          {settingsView && view === viewParam && project && (
            <button
              type="button"
              onClick={() => setCopyOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-[#1F4E9C] dark:text-[#7BA9EE] hover:bg-[#F3F5F8] dark:hover:bg-white/5"
            >
              <Copy className="w-4 h-4" />
              Перенести настройки
            </button>
          )}
          {(view === 'chats' || view === 'broadcasts') && project?.bot && project.personal && source && (
            <div className="inline-flex rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] p-1 gap-0.5">
              {(['BOT', 'PERSONAL'] as ChatSource[]).map((s) => {
                const unread = s === 'BOT' ? project.bot!.unread : project.personal!.unread;
                return (
                  <Link
                    key={s}
                    href={view === 'broadcasts' ? `${chatHref(project.id, s)}&view=broadcasts` : chatHref(project.id, s)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                      source === s
                        ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                        : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]',
                    )}
                  >
                    {s === 'BOT' ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                    {CHAT_SOURCE_LABEL[s]}
                    {unread > 0 && (
                      <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {copyOpen && project && (
        <CopySettingsDialog
          projects={projects ?? []}
          projectId={project.id}
          resource={settingsResource}
          resources={resources}
          onClose={() => setCopyOpen(false)}
        />
      )}
      {project && view === 'stages' && (
        <StagesDialog key={settingsResource} projectId={project.id} resource={settingsResource} inline onClose={() => setView('chats')} />
      )}
      {project && view === 'templates' && (
        <div className={cn(STUDIO_CARD, 'max-w-3xl mx-auto h-[calc(100vh-11rem)] min-h-[480px] overflow-hidden')}>
          <TemplatesSidebar key={settingsResource} projectId={project.id} resource={settingsResource} />
        </div>
      )}
      {project && view === 'fields' && <FieldsTab key={settingsResource} projectId={project.id} resource={settingsResource} onClose={() => setView('chats')} />}
      {project && view === 'tags' && <TagsPanel key={settingsResource} projectId={project.id} resource={settingsResource} />}
      {project && view === 'broadcasts' && source && <BroadcastsPanel key={source} projectId={project.id} source={source} />}
      {project && view === 'operators' && (
        <ChatOperatorsDialog projectId={project.id} inline initialResource={source === 'PERSONAL' ? 'PERSONAL' : 'BOT'} onClose={() => setView('chats')} />
      )}

      {view === 'chats' && projects && !project && (
        <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>Проект не найден или к нему нет доступа.</div>
      )}
      {view === 'chats' && project && !source && (
        <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>
          У проекта нет ни бота, ни подключённого личного аккаунта — переписываться не через что.
        </div>
      )}
      {view === 'chats' && project && source && canManage && (
        <div className="shrink-0">
          <DistributionBar projectId={project.id} source={source} />
        </div>
      )}
      {view === 'chats' && project && source && (
        <ProjectChat
          key={`${project.id}:${source}`}
          projectId={project.id}
          source={source}
          conversationId={conversationId}
          onBroadcastCreated={() => setView('broadcasts')}
          onSelect={(id) => {
            const params = new URLSearchParams(searchParams.toString());
            params.set('source', source);
            if (id) params.set('c', id);
            else params.delete('c');
            router.replace(`${pathname}?${params}`, { scroll: false });
          }}
        />
      )}
    </div>
  );
}

// Вкладка «Поля»: справочник полей проекта (заполняют их в переписке кнопкой «Поля»).
function FieldsTab({ projectId, resource, onClose }: { projectId: string; resource: string; onClose: () => void }) {
  const { data } = useChatFields(projectId, resource);
  if (!data) return null;
  return <FieldsManager projectId={projectId} resource={resource} fields={data.fields} inline onClose={onClose} />;
}

type ExtraFilters = Required<Pick<ConversationFilters, 'tagIds' | 'from' | 'to' | 'purchase' | 'traffic' | 'fieldId' | 'fieldValue'>>;
const EMPTY_EXTRA: ExtraFilters = { tagIds: [], from: '', to: '', purchase: '', traffic: '', fieldId: '', fieldValue: '' };

// Даты из полей ввода (дни браузера) → границы для API: «по» включительно, до начала следующего дня.
function dateRange(f: ExtraFilters): ConversationFilters {
  const day = (v: string, shift = 0) => {
    const d = new Date(`${v}T00:00:00`);
    d.setDate(d.getDate() + shift);
    return d.toISOString();
  };
  return {
    tagIds: f.tagIds,
    purchase: f.purchase,
    traffic: f.traffic,
    fieldId: f.fieldId,
    fieldValue: f.fieldValue,
    from: f.from ? day(f.from) : undefined,
    to: f.to ? day(f.to, 1) : undefined,
  };
}

// Папки проектов и избранное (2026-10-25, как «спейсы» в Chatterfy): вкладки над карточками,
// звёздочка — у каждого своя; папки и перенос проектов между ними — владелец и админы.
function ProjectPicker({ projects }: { projects: ChatProject[] | undefined }) {
  const queryClient = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canManageFolders = role === 'OWNER' || role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [view, setView] = useState<string>('all');
  const [error, setError] = useState('');
  const { data: folders } = useQuery({ queryKey: ['project-folders'], queryFn: fetchProjectFolders });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['chat-projects'] });
    queryClient.invalidateQueries({ queryKey: ['project-folders'] });
  };
  const onError = (err: unknown) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить');
  const favorite = useMutation({ mutationFn: (p: ChatProject) => setProjectFavorite(p.id, !p.favorite), onSuccess: refresh, onError });
  const move = useMutation({ mutationFn: (v: { projectId: string; folderId: string | null }) => setProjectFolder(v.projectId, v.folderId), onSuccess: refresh, onError });
  const addFolder = useMutation({ mutationFn: (name: string) => createProjectFolder(name), onSuccess: refresh, onError });
  const renameFolder = useMutation({ mutationFn: (v: { id: string; name: string }) => renameProjectFolder(v.id, v.name), onSuccess: refresh, onError });
  const removeFolder = useMutation({
    mutationFn: (id: string) => deleteProjectFolder(id),
    onSuccess: () => {
      setView('all');
      refresh();
    },
    onError,
  });

  const usedFolders = (folders ?? []).filter((f) => canManageFolders || projects?.some((p) => p.folderId === f.id));
  const visible = (projects ?? [])
    .filter((p) =>
      view === 'all' ? true : view === 'favorites' ? p.favorite : view === 'none' ? !p.folderId : p.folderId === view,
    )
    .sort((a, b) => Number(b.favorite) - Number(a.favorite));
  const currentFolder = folders?.find((f) => f.id === view);
  const tabs = [
    { id: 'all', name: 'Все' },
    ...(projects?.some((p) => p.favorite) ? [{ id: 'favorites', name: '★ Избранные' }] : []),
    ...usedFolders,
    ...(usedFolders.length && projects?.some((p) => !p.folderId) ? [{ id: 'none', name: 'Без папки' }] : []),
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Чаты</h1>
      {projects && projects.length === 0 && (
        <div className={`${STUDIO_CARD} p-10 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>
          <MessagesSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
          Нет проектов с Telegram, к которым у вас есть доступ.
        </div>
      )}
      {!!projects?.length && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                view === t.id
                  ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                  : 'bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]',
              )}
            >
              {t.id !== 'all' && t.id !== 'favorites' && t.id !== 'none' && <Folder className="w-3.5 h-3.5" />}
              {t.name}
            </button>
          ))}
          {canManageFolders && (
            <button
              type="button"
              onClick={() => {
                const name = prompt('Название папки (например, гео или источник трафика)');
                if (name?.trim()) addFolder.mutate(name.trim());
              }}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline"
            >
              <FolderPlus className="w-4 h-4" /> Папка
            </button>
          )}
          {canManageFolders && currentFolder && (
            <span className="inline-flex items-center gap-2 text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
              <button
                type="button"
                className="hover:underline"
                onClick={() => {
                  const name = prompt('Новое название папки', currentFolder.name);
                  if (name?.trim()) renameFolder.mutate({ id: currentFolder.id, name: name.trim() });
                }}
              >
                Переименовать
              </button>
              <button
                type="button"
                className="hover:underline hover:text-red-600"
                onClick={() => confirm(`Удалить папку «${currentFolder.name}»? Проекты останутся, просто без папки.`) && removeFolder.mutate(currentFolder.id)}
              >
                Удалить
              </button>
            </span>
          )}
          {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((p) => {
          const totalUnread = (p.bot?.unread ?? 0) + (p.personal?.unread ?? 0);
          return (
            <div key={p.id} className={`${STUDIO_CARD} p-4 flex flex-col gap-3`}>
              <div className="flex items-center gap-3">
                <ChannelAvatar channelId={p.channelId} hasAvatar={p.hasAvatar} fallbackLetter={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[#131A24] dark:text-[#E9EDF3] truncate">{p.name}</div>
                  <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                    {totalUnread > 0 ? `${totalUnread} непрочитанных диалогов` : 'Нет непрочитанных'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => favorite.mutate(p)}
                  className="p-1.5 rounded-lg hover:bg-[#F3F5F8] dark:hover:bg-white/5"
                  title={p.favorite ? 'Убрать из избранного' : 'В избранное'}
                >
                  <Star className={cn('w-4 h-4', p.favorite ? 'fill-amber-400 text-amber-400' : 'text-[#5F6B7A] dark:text-[#92A0AF]')} />
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                {p.bot && (
                  <ChatEntry
                    href={chatHref(p.id, 'BOT')}
                    icon={Bot}
                    title="Чат бота"
                    subtitle={p.bot.username ? `@${p.bot.username}${p.bot.active ? '' : ' · отключён'}` : 'бот'}
                    unread={p.bot.unread}
                  />
                )}
                {p.personal && (
                  <ChatEntry
                    href={chatHref(p.id, 'PERSONAL')}
                    icon={User}
                    title="Чат лички"
                    subtitle={p.personal.username ?? 'личный аккаунт'}
                    unread={p.personal.unread}
                  />
                )}
                {!p.bot && !p.personal && (
                  <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Нет бота и не подключён личный аккаунт</div>
                )}
              </div>
              {canManageFolders && !!folders?.length && (
                <label className="flex items-center gap-1.5 text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                  <Folder className="w-3.5 h-3.5" />
                  <select
                    value={p.folderId ?? ''}
                    onChange={(e) => move.mutate({ projectId: p.id, folderId: e.target.value || null })}
                    className="h-7 flex-1 min-w-0 rounded-md bg-[#F3F5F8] dark:bg-[#0F1620] px-1.5 text-[#131A24] dark:text-[#E9EDF3] outline-none"
                  >
                    <option value="">Без папки</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          );
        })}
      </div>
      {projects && projects.length > 0 && visible.length === 0 && (
        <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>В этой папке пока нет проектов.</div>
      )}
    </div>
  );
}

function ChatEntry({
  href,
  icon: Icon,
  title,
  subtitle,
  unread,
}: {
  href: string;
  icon: typeof Bot;
  title: string;
  subtitle: string;
  unread: number;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 bg-[#F3F5F8] dark:bg-[#0F1620] hover:bg-[#1F4E9C]/10 dark:hover:bg-[#7BA9EE]/10 transition-colors"
    >
      <Icon className="w-4 h-4 shrink-0 text-[#1F4E9C] dark:text-[#7BA9EE]" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[#131A24] dark:text-[#E9EDF3]">{title}</div>
        <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] truncate">{subtitle}</div>
      </div>
      {unread > 0 && (
        <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
      <ChevronRight className="w-4 h-4 shrink-0 text-[#5F6B7A] dark:text-[#92A0AF]" />
    </Link>
  );
}

function ProjectChat({
  projectId,
  source,
  conversationId,
  onSelect,
  onBroadcastCreated,
}: {
  projectId: string;
  source: ChatSource;
  conversationId: string | null;
  onSelect: (id: string | null) => void;
  onBroadcastCreated: () => void;
}) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Вкладки и фильтры как в Chatterfy (2026-10-25).
  // Фильтры списка — по настройкам выбранного канала (основной бот или личка).
  const listResource = source === 'PERSONAL' ? 'PERSONAL' : 'BOT';
  const [tab, setTab] = useState<ChatTab>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [extra, setExtra] = useState<ExtraFilters>(EMPTY_EXTRA);
  const activeExtra =
    (extra.tagIds?.length ? 1 : 0) + (extra.from || extra.to ? 1 : 0) + (extra.purchase ? 1 : 0) + (extra.traffic ? 1 : 0) + (extra.fieldId && extra.fieldValue?.trim() ? 1 : 0);
  const { data: projectFields } = useQuery({
    queryKey: ['chat-fields', projectId, listResource],
    queryFn: () => fetchChatFields(projectId, listResource),
    staleTime: 60_000,
  });
  const filterField = projectFields?.fields.find((f) => f.id === extra.fieldId);
  // Правая колонка (2026-10-25): карточка клиента или шаблоны ответов. Выбранный в шаблонах ответ
  // уходит в поле ввода переписки через pendingTemplate.
  const [side, setSide] = useState<'client' | 'templates' | null>('client');
  const [pendingTemplate, setPendingTemplate] = useState<{ template: ChatTemplate; nonce: number } | null>(null);
  // Выбранный ответ относится к открытому диалогу — в другой чат он не переезжает.
  useEffect(() => setPendingTemplate(null), [conversationId]);
  // Ответственные (2026-10-25): фильтр списка и передача нескольких диалогов сразу.
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canManage = canManageChatOperators(user?.role);
  const [assignee, setAssignee] = useState('');
  const [stage, setStage] = useState('');
  const { data: stagesData } = useChatStages(projectId, listResource);
  const stages = stagesData?.stages ?? [];
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState('');
  const [bulkError, setBulkError] = useState('');
  // Рассылка из чата (2026-10-25): ids — выбранные диалоги, без них — все по текущему фильтру.
  const [broadcast, setBroadcast] = useState<{ ids?: string[] } | null>(null);
  const [transferFrom, setTransferFrom] = useState<string | null>(null);
  const { data: access } = useQuery({
    queryKey: ['chat-access', projectId],
    queryFn: () => fetchChatAccess(projectId),
    enabled: canManage,
  });
  const operators = (access?.operators ?? []).filter((o) => o.isActive);
  const bulk = useMutation({
    mutationFn: (userId: string | null) => assignConversations(Array.from(selectedIds), userId),
    onSuccess: () => {
      setSelecting(false);
      setSelectedIds(new Set());
      setBulkTarget('');
      setBulkError('');
      queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['chat-conversation'] });
      queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
    },
    onError: (err) => setBulkError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось передать'),
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const listQuery = useInfiniteQuery({
    queryKey: ['chat-conversations', { projectId, source, search: debouncedSearch, assignee, tab, extra, stage }],
    queryFn: ({ pageParam }) =>
      fetchConversations({ projectId, source, search: debouncedSearch, before: pageParam, assignee, tab, stage, ...dateRange(extra) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.items[last.items.length - 1]?.lastMessageAt : undefined),
    refetchInterval: LIST_POLL_MS,
  });
  const { data: counts } = useQuery({
    queryKey: ['chat-conversations', 'counts', { projectId, source, assignee, extra, stage }],
    queryFn: () => fetchTabCounts({ projectId, source, assignee, stage, ...dateRange(extra) }),
    refetchInterval: LIST_POLL_MS,
  });
  const { data: projectTags } = useQuery({
    queryKey: ['chat-tags', projectId, listResource],
    queryFn: () => fetchChatTags(projectId, listResource),
  });

  const conversations = useMemo(() => {
    const seen = new Set<string>();
    return (listQuery.data?.pages ?? []).flatMap((p) => p.items).filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  }, [listQuery.data]);

  const { data: selectedDetail } = useQuery({
    queryKey: ['chat-conversation', conversationId],
    queryFn: async () => (await api.get<{ projectId: string; clientId: string | null; source: ChatSource; botKey: string }>(`/chat/conversations/${conversationId}`)).data,
    enabled: !!conversationId,
  });
  const clientId = conversations.find((c) => c.id === conversationId)?.clientId ?? selectedDetail?.clientId ?? null;

  return (
    <div className={cn(STUDIO_CARD, 'flex overflow-hidden flex-1 min-h-[420px]')}>
      <div className={cn('w-full lg:w-[340px] shrink-0 border-r border-[#DCE1E8] dark:border-white/10', conversationId ? 'hidden lg:block' : 'block')}>
        <ConversationList
          items={conversations}
          selectedId={conversationId}
          onSelect={onSelect}
          showProject={false}
          search={search}
          onSearchChange={setSearch}
          filtered={tab !== 'all' || !!assignee || activeExtra > 0 || !!stage}
          stages={stages}
          onTogglePin={(c) =>
            setConversationPinned(c.id, !c.pinned)
              .then(() => {
                queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
                queryClient.invalidateQueries({ queryKey: ['chat-conversation', c.id] });
              })
              .catch((err) => alert((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось закрепить'))
          }
          toolbar={
            <div className="space-y-2">
            <div className="-mx-3 px-3 flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none]">
              {CHAT_TABS.map((t) => {
                const n = counts?.[t.value];
                return (
                  <button
                    key={t.value}
                    type="button"
                    title={t.hint}
                    onClick={() => setTab(t.value)}
                    className={cn(
                      'shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                      tab === t.value
                        ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                        : 'bg-[#F3F5F8] dark:bg-[#0F1620] text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]',
                    )}
                  >
                    {t.label}
                    {n !== undefined && n > 0 && <span className={cn('tabular-nums', tab === t.value ? 'opacity-80' : 'opacity-70')}>{n > 999 ? '999+' : n}</span>}
                  </button>
                );
              })}
            </div>
            {stages.length > 0 && (
              <div className="-mx-3 px-3 flex gap-1 overflow-x-auto [scrollbar-width:none]">
                {[{ id: '', name: 'Все этапы', color: '' }, ...stages, { id: 'none', name: 'Без этапа', color: '' }].map((st) => (
                  <button
                    key={st.id || 'all'}
                    type="button"
                    onClick={() => setStage(st.id)}
                    className={cn(
                      'shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors',
                      stage === st.id
                        ? 'border-[#1F4E9C] bg-[#1F4E9C]/10 text-[#1F4E9C] dark:border-[#7BA9EE] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]'
                        : 'border-[#DCE1E8] dark:border-white/10 text-[#5F6B7A] dark:text-[#92A0AF]',
                    )}
                  >
                    {st.color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: st.color }} />}
                    {st.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="h-7 min-w-[120px] flex-1 truncate rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2 text-xs text-[#131A24] dark:text-[#E9EDF3] outline-none"
                aria-label="Ответственный"
              >
                <option value="">Все ответственные</option>
                {!canManage && <option value="me">Мои</option>}
                {canManage && <option value="none">Без ответственного</option>}
                {canManage &&
                  operators.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                {canManage &&
                  (access?.formerOperators ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.deleted ? 'удалён' : 'заблокирован'}, {o.chats})
                    </option>
                  ))}
              </select>
              {canManage && assignee && assignee !== 'none' && assignee !== 'me' && (
                <button
                  type="button"
                  onClick={() => setTransferFrom(assignee)}
                  className="h-7 shrink-0 inline-flex items-center rounded-lg px-2 bg-[#F3F5F8] dark:bg-[#0F1620] text-[#1F4E9C] dark:text-[#7BA9EE] hover:bg-[#1F4E9C]/10"
                  title="Передать все чаты этого оператора другому или снять ответственного"
                  aria-label="Передать все чаты оператора"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  onClick={() => {
                    setSelecting((v) => !v);
                    setSelectedIds(new Set());
                    setBulkError('');
                  }}
                  className={cn(
                    'h-7 shrink-0 inline-flex items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors',
                    selecting
                      ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                      : 'bg-[#F3F5F8] dark:bg-[#0F1620] text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]',
                  )}
                  title="Выбрать несколько чатов и передать оператору"
                  aria-label="Выбрать чаты"
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  onClick={() => setBroadcast({})}
                  className="h-7 shrink-0 inline-flex items-center gap-1 rounded-lg px-2 text-xs font-medium bg-[#F3F5F8] dark:bg-[#0F1620] text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]"
                  title="Разослать сообщение всем диалогам по текущему фильтру"
                >
                  <Megaphone className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className={cn(
                  'h-7 shrink-0 inline-flex items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors',
                  filtersOpen || activeExtra
                    ? 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]'
                    : 'bg-[#F3F5F8] dark:bg-[#0F1620] text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]',
                )}
                title="Фильтры: теги, даты, покупка"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                {activeExtra > 0 && <span className="tabular-nums">{activeExtra}</span>}
              </button>
            </div>
            {filtersOpen && (
              <div className="rounded-lg border border-[#DCE1E8] dark:border-white/10 p-2.5 space-y-2.5 text-xs">
                <div>
                  <div className="mb-1 text-[#5F6B7A] dark:text-[#92A0AF]">Теги (любой из)</div>
                  {projectTags?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {projectTags.map((t) => {
                        const on = !!extra.tagIds?.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() =>
                              setExtra((prev) => ({ ...prev, tagIds: on ? prev.tagIds!.filter((id) => id !== t.id) : [...(prev.tagIds ?? []), t.id] }))
                            }
                            className={cn('rounded-full px-2 py-0.5 font-medium border dark:brightness-150', on ? '' : 'opacity-60 hover:opacity-100')}
                            style={{ backgroundColor: on ? `${t.color}26` : 'transparent', color: t.color, borderColor: `${t.color}55` }}
                          >
                            {t.name} <span className="opacity-60">{t.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-[#5F6B7A] dark:text-[#92A0AF]">Тегов пока нет — их добавляют в шапке переписки.</div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[#5F6B7A] dark:text-[#92A0AF]">Начало диалога</span>
                  <input
                    type="date"
                    value={extra.from}
                    onChange={(e) => setExtra((prev) => ({ ...prev, from: e.target.value }))}
                    className="h-7 rounded-md bg-[#F3F5F8] dark:bg-[#0F1620] px-1.5 text-[#131A24] dark:text-[#E9EDF3] outline-none"
                  />
                  <span className="text-[#5F6B7A]">—</span>
                  <input
                    type="date"
                    value={extra.to}
                    onChange={(e) => setExtra((prev) => ({ ...prev, to: e.target.value }))}
                    className="h-7 rounded-md bg-[#F3F5F8] dark:bg-[#0F1620] px-1.5 text-[#131A24] dark:text-[#E9EDF3] outline-none"
                  />
                </div>
                {!!projectFields?.fields.length && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[#5F6B7A] dark:text-[#92A0AF]">Поле</span>
                    <select
                      value={extra.fieldId}
                      onChange={(e) => setExtra((prev) => ({ ...prev, fieldId: e.target.value, fieldValue: '' }))}
                      className="h-7 max-w-[140px] rounded-md bg-[#F3F5F8] dark:bg-[#0F1620] px-1.5 text-[#131A24] dark:text-[#E9EDF3] outline-none"
                    >
                      <option value="">—</option>
                      {projectFields.fields.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                    {filterField &&
                      (filterField.options.length ? (
                        <select
                          value={extra.fieldValue}
                          onChange={(e) => setExtra((prev) => ({ ...prev, fieldValue: e.target.value }))}
                          className="h-7 max-w-[140px] rounded-md bg-[#F3F5F8] dark:bg-[#0F1620] px-1.5 text-[#131A24] dark:text-[#E9EDF3] outline-none"
                        >
                          <option value="">любое</option>
                          {filterField.options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={extra.fieldValue}
                          onChange={(e) => setExtra((prev) => ({ ...prev, fieldValue: e.target.value }))}
                          placeholder="значение"
                          className="h-7 w-28 rounded-md bg-[#F3F5F8] dark:bg-[#0F1620] px-1.5 text-[#131A24] dark:text-[#E9EDF3] outline-none"
                        />
                      ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-[#5F6B7A] dark:text-[#92A0AF]">Источник</span>
                  <select
                    value={extra.traffic}
                    onChange={(e) => setExtra((prev) => ({ ...prev, traffic: e.target.value as ExtraFilters['traffic'] }))}
                    className="h-7 rounded-md bg-[#F3F5F8] dark:bg-[#0F1620] px-1.5 text-[#131A24] dark:text-[#E9EDF3] outline-none"
                  >
                    <option value="">Любой</option>
                    <option value="FB">Facebook</option>
                    <option value="TT">TikTok</option>
                    <option value="none">Без метки (органика)</option>
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[#5F6B7A] dark:text-[#92A0AF]">Покупка</span>
                  <select
                    value={extra.purchase}
                    onChange={(e) => setExtra((prev) => ({ ...prev, purchase: e.target.value as ExtraFilters['purchase'] }))}
                    className="h-7 rounded-md bg-[#F3F5F8] dark:bg-[#0F1620] px-1.5 text-[#131A24] dark:text-[#E9EDF3] outline-none"
                  >
                    <option value="">Неважно</option>
                    <option value="yes">Есть покупка (FD)</option>
                    <option value="no">Без покупки</option>
                  </select>
                  {activeExtra > 0 && (
                    <button
                      type="button"
                      onClick={() => setExtra(EMPTY_EXTRA)}
                      className="ml-auto text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline"
                    >
                      Сбросить
                    </button>
                  )}
                </div>
              </div>
            )}
            </div>
          }
          hasMore={!!listQuery.hasNextPage}
          onLoadMore={() => listQuery.fetchNextPage()}
          isLoading={listQuery.isLoading}
          emptyText={
            assignee
              ? 'Нет диалогов с таким ответственным'
              : source === 'BOT'
                ? 'Здесь появятся люди, которые написали боту'
                : 'Здесь появятся люди, которые написали в личку'
          }
          currentUserId={user?.id}
          selection={
            selecting
              ? {
                  ids: selectedIds,
                  onToggle: (id) =>
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    }),
                }
              : null
          }
          footer={
            selecting && (
              <div className="shrink-0 border-t border-[#DCE1E8] dark:border-white/10 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                  <span>Выбрано: {selectedIds.size}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set(conversations.map((c) => c.id)))}
                    className="text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline"
                  >
                    Выбрать все на экране
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={bulkTarget}
                    onChange={(e) => setBulkTarget(e.target.value)}
                    className="h-8 min-w-0 flex-1 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2 text-xs text-[#131A24] dark:text-[#E9EDF3] outline-none"
                  >
                    <option value="">Кому передать…</option>
                    {operators.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!bulkTarget || selectedIds.size === 0 || bulk.isPending}
                    onClick={() => bulk.mutate(bulkTarget)}
                    className="h-8 shrink-0 rounded-lg px-3 text-xs font-semibold bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] disabled:opacity-40"
                  >
                    Передать
                  </button>
                </div>
                <button
                  type="button"
                  disabled={selectedIds.size === 0}
                  onClick={() => setBroadcast({ ids: Array.from(selectedIds) })}
                  className="w-full h-8 rounded-lg text-xs font-semibold border border-[#1F4E9C] text-[#1F4E9C] dark:border-[#7BA9EE] dark:text-[#7BA9EE] disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
                >
                  <Megaphone className="w-3.5 h-3.5" /> Разослать выбранным
                </button>
                <button
                  type="button"
                  disabled={selectedIds.size === 0 || bulk.isPending}
                  onClick={() => bulk.mutate(null)}
                  className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] hover:text-red-600 disabled:opacity-40"
                >
                  Снять ответственного у выбранных
                </button>
                {bulkError && <div className="text-xs text-red-600 dark:text-red-400">{bulkError}</div>}
              </div>
            )
          }
        />
      </div>

      <div className={cn('flex-1 min-w-0', conversationId ? 'block' : 'hidden lg:block')}>
        {conversationId ? (
          <Thread
            conversationId={conversationId}
            onBack={() => onSelect(null)}
            side={side}
            onToggleSide={(panel) => setSide((v) => (v === panel ? null : panel))}
            pendingTemplate={pendingTemplate}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6 bg-[#F3F5F8] dark:bg-[#0F1620]">
            <div className="w-14 h-14 rounded-2xl bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/10 flex items-center justify-center">
              {source === 'BOT' ? <Bot className="w-7 h-7 text-[#1F4E9C] dark:text-[#7BA9EE]" /> : <User className="w-7 h-7 text-[#1F4E9C] dark:text-[#7BA9EE]" />}
            </div>
            <div className="text-sm font-medium text-[#131A24] dark:text-[#E9EDF3]">Выберите диалог</div>
            <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] max-w-xs">
              {source === 'BOT'
                ? 'Ответ уйдёт от имени бота проекта.'
                : 'Ответ уйдёт с личного аккаунта. Сообщения, которые оператор пишет с телефона, тоже появятся здесь.'}
            </div>
          </div>
        )}
      </div>

      {transferFrom && (
        <TransferChatsDialog
          fromUserId={transferFrom}
          initialProjectId={projectId}
          initialSource={source}
          onClose={() => setTransferFrom(null)}
          onDone={() => {
            setTransferFrom(null);
            setAssignee('');
          }}
        />
      )}
      {broadcast && (
        <BroadcastDialog
          filter={{ projectId, source, search: debouncedSearch, assignee, tab, stage, ...dateRange(extra) }}
          conversationIds={broadcast.ids}
          onClose={() => setBroadcast(null)}
          onCreated={() => {
            setBroadcast(null);
            setSelecting(false);
            setSelectedIds(new Set());
            onBroadcastCreated();
          }}
        />
      )}
      {conversationId && side && (side === 'templates' || clientId) && (
        <div className="hidden xl:flex flex-col w-[340px] shrink-0 border-l border-[#DCE1E8] dark:border-white/10 min-h-0">
          <div className="flex items-center gap-1 px-2 h-11 shrink-0 border-b border-[#DCE1E8] dark:border-white/10">
            {(clientId ? (['client', 'templates'] as const) : (['templates'] as const)).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setSide(tab)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors',
                  side === tab
                    ? 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]'
                    : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]',
                )}
              >
                {tab === 'client' ? 'Клиент' : 'Шаблоны'}
              </button>
            ))}
            <button type="button" onClick={() => setSide(null)} className="ml-auto p-1 rounded text-[#5F6B7A] hover:bg-[#F3F5F8] dark:hover:bg-white/5" aria-label="Скрыть">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            {side === 'client' && clientId ? (
              <ClientDetailContent key={clientId} projectId={projectId} clientId={clientId} onClose={() => setSide(null)} hideDelete hideChatButton />
            ) : (
              <TemplatesSidebar
                projectId={projectId}
                resource={selectedDetail ? chatResourceOf(selectedDetail) : listResource}
                onPick={(template) => setPendingTemplate({ template, nonce: Date.now() })} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
