'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { format, isToday, isYesterday } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ArrowLeft, BookText, Clock, Languages, Loader2, PanelRight, Paperclip, SendHorizontal, Undo2, UserRound, X } from 'lucide-react';
import { api } from '@/lib/api';
import {
  chatResourceOf,
  ConversationDetail,
  TRANSLATION_LANGS,
  TranslatePrefs,
  ChatTemplate,
  assignConversations,
  cancelScheduled,
  fetchChatAccess,
  fetchMessages,
  fetchScheduled,
  scheduleMessage,
  langLabel,
  loadTranslatePrefs,
  peerDisplayName,
  saveTranslatePrefs,
  sendChatMessage,
  translateDraft,
} from '@/lib/chat';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import { ChatAvatar } from './chat-avatar';
import { TrafficBadge } from './traffic-badge';
import { MessageBubble } from './message-bubble';
import { OrganizeBar } from './organize-bar';
import { TemplateKindBadge, TemplatePicker, matchTemplates, useChatTemplates } from './templates';

const MESSAGES_POLL_MS = 3000;
// «#код» шаблона прямо перед курсором (буквы любого алфавита, цифры, «-», «_»).
const HASH_TOKEN = new RegExp('(?:^|\\s)#([\\p{L}\\p{N}_-]*)$', 'u');

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Сегодня';
  if (isYesterday(date)) return 'Вчера';
  return format(date, 'd MMMM yyyy', { locale: ru });
}

export function Thread({
  conversationId,
  onBack,
  side,
  onToggleSide,
  pendingTemplate,
}: {
  conversationId: string;
  onBack: () => void;
  // Правая колонка: карточка клиента или шаблоны ответов (2026-10-25).
  side: 'client' | 'templates' | null;
  onToggleSide: (panel: 'client' | 'templates') => void;
  pendingTemplate: { template: ChatTemplate; nonce: number } | null;
}) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const restoreFromBottom = useRef<number | null>(null);

  const { data: conversation } = useQuery({
    queryKey: ['chat-conversation', conversationId],
    queryFn: async () => (await api.get<ConversationDetail>(`/chat/conversations/${conversationId}`)).data,
  });

  // Страница 0 — последние сообщения (её и опрашиваем), дальше — всё более старые.
  const messagesQuery = useInfiniteQuery({
    queryKey: ['chat-messages', conversationId],
    queryFn: ({ pageParam }) => fetchMessages(conversationId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore && last.items.length ? last.items[0].createdAt : undefined),
    refetchInterval: MESSAGES_POLL_MS,
  });

  const messages = useMemo(() => {
    const pages = messagesQuery.data?.pages ?? [];
    const seen = new Set<string>();
    return pages
      .slice()
      .reverse()
      .flatMap((p) => p.items)
      .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  }, [messagesQuery.data]);

  const lastIncomingId = useMemo(() => [...messages].reverse().find((m) => m.direction === 'IN')?.id, [messages]);

  // Открыл диалог / пришло новое входящее, пока он открыт — прочитано.
  useEffect(() => {
    if (!lastIncomingId || document.visibilityState !== 'visible') return;
    api.post(`/chat/conversations/${conversationId}/read`).then(() => {
      queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['chat-unread'] });
      queryClient.invalidateQueries({ queryKey: ['chat-projects'] });
    });
  }, [conversationId, lastIncomingId, queryClient]);

  // Новый диалог открывается внизу.
  useEffect(() => {
    stickToBottom.current = true;
  }, [conversationId]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoreFromBottom.current !== null) {
      // Подгрузили историю сверху — оставляем пользователя на том же сообщении.
      el.scrollTop = el.scrollHeight - restoreFromBottom.current;
      restoreFromBottom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && messagesQuery.hasNextPage && !messagesQuery.isFetchingNextPage) {
      restoreFromBottom.current = el.scrollHeight - el.scrollTop;
      messagesQuery.fetchNextPage();
    }
  };

  const name = conversation ? peerDisplayName(conversation) : '';

  // Переводчик (2026-10-24): языки — личный выбор пользователя для этого бота/лички проекта.
  const userId = useAuthStore((s) => s.user?.id) ?? '';
  const { data: translateStatus } = useQuery({
    queryKey: ['chat-translate-status'],
    queryFn: async () => (await api.get<{ enabled: boolean }>('/chat/translate/status')).data,
    staleTime: 5 * 60_000,
  });
  const translationEnabled = !!translateStatus?.enabled;
  const [prefs, setPrefs] = useState<TranslatePrefs>({ read: 'ru', write: 'auto' });
  const [langPanelOpen, setLangPanelOpen] = useState(false);
  const prefsTarget = conversation ? { projectId: conversation.projectId, source: conversation.source, botKey: conversation.botKey ?? '' } : null;
  const prefsKey = prefsTarget ? `${prefsTarget.projectId}:${prefsTarget.source}:${prefsTarget.botKey}` : '';
  useEffect(() => {
    if (prefsTarget) setPrefs(loadTranslatePrefs(userId, prefsTarget));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsKey, userId]);
  const updatePrefs = (patch: Partial<TranslatePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (prefsTarget) saveTranslatePrefs(userId, prefsTarget, next);
  };
  const writeLang = prefs.write === 'auto' ? conversation?.clientLanguage ?? null : prefs.write;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="h-16 shrink-0 flex items-center gap-3 px-4 border-b border-[#DCE1E8] dark:border-white/10">
        <button type="button" onClick={onBack} className="lg:hidden -ml-1 p-1.5 rounded-lg hover:bg-[#F3F5F8] dark:hover:bg-white/5" aria-label="К списку">
          <ArrowLeft className="w-4 h-4" />
        </button>
        {conversation && (
          <>
            <ChatAvatar
              projectId={conversation.projectId}
              clientId={conversation.clientId}
              hasAvatar={!!conversation.clientId}
              seed={conversation.peerId}
              name={name}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="truncate font-semibold text-[15px] text-[#131A24] dark:text-[#E9EDF3]">{name}</span>
                <TrafficBadge source={conversation?.trafficSource} />
              </div>
              <div className="truncate text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                {conversation.peerUsername && `@${conversation.peerUsername} · `}
                {conversation.source === 'PERSONAL'
                  ? `личка${conversation.project.personalUsername ? ` ${conversation.project.personalUsername}` : ''}`
                  : `бот${conversation.project.botUsername ? ` @${conversation.project.botUsername}` : ''}`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLangPanelOpen((v) => !v)}
              className={cn(
                'p-2 rounded-lg transition-colors',
                langPanelOpen
                  ? 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]'
                  : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-[#F3F5F8] dark:hover:bg-white/5',
              )}
              aria-label="Языки перевода"
              title="Языки перевода"
            >
              <Languages className="w-4 h-4" />
            </button>
            <AssigneeControl conversation={conversation} onReturned={onBack} />
            <button
              type="button"
              onClick={() => onToggleSide('templates')}
              className={cn(
                'hidden xl:inline-flex p-2 rounded-lg transition-colors',
                side === 'templates'
                  ? 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]'
                  : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-[#F3F5F8] dark:hover:bg-white/5',
              )}
              aria-label="Шаблоны ответов"
              title="Шаблоны ответов"
            >
              <BookText className="w-4 h-4" />
            </button>
            {conversation.clientId && (
              <button
                type="button"
                onClick={() => onToggleSide('client')}
                className={cn(
                  'p-2 rounded-lg transition-colors',
                  side === 'client'
                    ? 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]'
                    : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-[#F3F5F8] dark:hover:bg-white/5',
                )}
                aria-label="Карточка клиента"
                title="Карточка клиента"
              >
                <PanelRight className="w-4 h-4" />
              </button>
            )}
          </>
        )}
      </div>

      {conversation && <OrganizeBar conversation={conversation} />}

      {conversation && langPanelOpen && (
        <div className="shrink-0 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 border-b border-[#DCE1E8] dark:border-white/10 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-[#5F6B7A] dark:text-[#92A0AF]">Читать на</span>
            <LangSelect value={prefs.read} onChange={(read) => updatePrefs({ read })} />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[#5F6B7A] dark:text-[#92A0AF]">Писать на</span>
            <LangSelect
              value={prefs.write}
              onChange={(write) => updatePrefs({ write })}
              autoLabel={`Авто${conversation.clientLanguage ? ` (${langLabel(conversation.clientLanguage).toLowerCase()})` : ' — язык неизвестен'}`}
            />
          </label>
          <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
            {translationEnabled ? 'Настройка только для вас и только для этого чата проекта' : 'Перевод не настроен на сервере'}
          </span>
        </div>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto bg-[#F3F5F8] dark:bg-[#0F1620] px-4 py-4">
        {messagesQuery.isFetchingNextPage && (
          <div className="flex justify-center py-2">
            <Loader2 className="w-4 h-4 animate-spin text-[#5F6B7A]" />
          </div>
        )}
        {messagesQuery.isLoading && (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-[#5F6B7A]" />
          </div>
        )}
        <div className="space-y-1.5 max-w-3xl mx-auto">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const date = new Date(m.createdAt);
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== date.toDateString();
            const showSender =
              m.direction === 'OUT' && (newDay || !prev || prev.direction !== 'OUT' || prev.senderType !== m.senderType || prev.senderUserId !== m.senderUserId);
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="flex justify-center my-3">
                    <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-white/80 dark:bg-white/5 text-[#5F6B7A] dark:text-[#92A0AF] shadow-sm">
                      {dayLabel(date)}
                    </span>
                  </div>
                )}
                <div className={cn(showSender || (prev && prev.direction !== m.direction) ? 'pt-2' : '')}>
                  <MessageBubble message={m} showSender={showSender} translateTo={prefs.read} translationEnabled={translationEnabled} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {conversation && (
        <Composer
          conversation={conversation}
          writeLang={writeLang}
          translationEnabled={translationEnabled}
          onPickLanguage={() => setLangPanelOpen(true)}
          pendingTemplate={pendingTemplate}
          onOpenTemplates={() => onToggleSide('templates')}
          templatesInSide={side === 'templates'}
          onSent={() => {
            stickToBottom.current = true;
            queryClient.invalidateQueries({ queryKey: ['chat-messages', conversationId] });
            queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
            queryClient.invalidateQueries({ queryKey: ['chat-conversation', conversationId] });
          }}
        />
      )}
    </div>
  );
}

// Ответственный за диалог (2026-10-25): тимлид/админ выбирает оператора, оператор может вернуть
// свой чат тимлиду, остальные просто видят, кто ведёт диалог.
function AssigneeControl({ conversation, onReturned }: { conversation: ConversationDetail; onReturned: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const { data: access } = useQuery({
    queryKey: ['chat-access', conversation.projectId],
    queryFn: () => fetchChatAccess(conversation.projectId),
    enabled: conversation.canAssign,
  });
  const assign = useMutation({
    mutationFn: (userId: string | null) => assignConversations([conversation.id], userId),
    onSuccess: () => {
      setError('');
      // Вернул чат тимлиду — без полного доступа к ресурсу диалог у оператора пропадает.
      if (conversation.canReturn) onReturned();
      queryClient.invalidateQueries({ queryKey: ['chat-conversation', conversation.id] });
      queryClient.invalidateQueries({ queryKey: ['chat-messages', conversation.id] });
      queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось'),
  });

  if (conversation.canAssign) {
    const operators = (access?.operators ?? []).filter((o) => o.isActive || o.id === conversation.assignee?.id);
    return (
      <label className="hidden sm:flex items-center gap-1.5 shrink-0" title={error || 'Ответственный за диалог'}>
        <UserRound className={cn('w-4 h-4', error ? 'text-red-500' : 'text-[#5F6B7A] dark:text-[#92A0AF]')} />
        <select
          value={conversation.assignee?.id ?? ''}
          disabled={assign.isPending}
          onChange={(e) => assign.mutate(e.target.value || null)}
          className="h-8 max-w-[180px] rounded-lg border border-[#DCE1E8] dark:border-white/10 bg-white dark:bg-[#171F2B] px-2 text-sm text-[#131A24] dark:text-[#E9EDF3] outline-none focus:ring-2 focus:ring-[#1F4E9C]/30 dark:focus:ring-[#7BA9EE]/30"
        >
          <option value="">Без ответственного</option>
          {conversation.assignee && !operators.some((o) => o.id === conversation.assignee!.id) && (
            <option value={conversation.assignee.id}>{conversation.assignee.name}</option>
          )}
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (conversation.canReturn) {
    return (
      <button
        type="button"
        disabled={assign.isPending}
        onClick={() => assign.mutate(null)}
        title={error || 'Чат снова станет без ответственного, тимлид передаст его другому оператору'}
        className="shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-[#F3F5F8] dark:hover:bg-white/5"
      >
        <Undo2 className="w-4 h-4" /> <span className="hidden sm:inline">Вернуть тимлиду</span>
      </button>
    );
  }
  if (conversation.assignee) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1 shrink-0 text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
        <UserRound className="w-3.5 h-3.5" /> {conversation.assignee.name}
      </span>
    );
  }
  return null;
}

function LangSelect({ value, onChange, autoLabel }: { value: string; onChange: (v: string) => void; autoLabel?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-lg border border-[#DCE1E8] dark:border-white/10 bg-white dark:bg-[#171F2B] px-2 text-sm text-[#131A24] dark:text-[#E9EDF3] outline-none focus:ring-2 focus:ring-[#1F4E9C]/30 dark:focus:ring-[#7BA9EE]/30"
    >
      {autoLabel && <option value="auto">{autoLabel}</option>}
      {TRANSLATION_LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

function Composer({
  conversation,
  onSent,
  writeLang,
  translationEnabled,
  onPickLanguage,
  pendingTemplate,
  onOpenTemplates,
  templatesInSide,
}: {
  conversation: ConversationDetail;
  onSent: () => void;
  writeLang: string | null;
  translationEnabled: boolean;
  onPickLanguage: () => void;
  pendingTemplate: { template: ChatTemplate; nonce: number } | null;
  onOpenTemplates: () => void;
  templatesInSide: boolean;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  // Текст до перевода — пока он есть, кнопка перевода возвращает оригинал. Правка переведённого
  // текста руками его сбрасывает: возвращать уже нечего.
  const [original, setOriginal] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  // Шаблоны ответов и отложенная отправка (2026-10-25, как в Chatterfy).
  const [tplAttach, setTplAttach] = useState<ChatTemplate | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hash, setHash] = useState<{ query: string; start: number } | null>(null);
  const [hashIndex, setHashIndex] = useState(0);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: templates } = useChatTemplates(conversation.projectId, chatResourceOf(conversation));
  const suggestions = hash ? matchTemplates(templates?.folders, hash.query) : [];

  // Черновик не переезжает в другой диалог.
  useEffect(() => {
    setText('');
    setFile(null);
    setError('');
    setOriginal(null);
    setTplAttach(null);
    setHash(null);
    setPickerOpen(false);
    setScheduleOpen(false);
  }, [conversation.id]);

  // Вставка шаблона: текст — в поле (вместо набранного «#код», если он есть), файл — вложением.
  const applyTemplate = (t: ChatTemplate) => {
    // Цепочка из нескольких сообщений (2026-10-25) — прикрепляется целиком, текст в поле не
    // трогаем: набранное оператором уйдёт первым, потом сообщения шаблона по порядку.
    if (t.messages.length > 1) {
      if (hash) {
        const caret = hash.start + 1 + hash.query.length;
        setText((prev) => prev.slice(0, hash.start) + prev.slice(caret));
      }
      setTplAttach(t);
      setFile(null);
      setHash(null);
      setPickerOpen(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }
    const body = t.text ?? '';
    if (hash) {
      const caret = hash.start + 1 + hash.query.length;
      setText((prev) => prev.slice(0, hash.start) + body + prev.slice(caret));
    } else if (body) {
      setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n${body}` : body));
    }
    if (t.mediaKind) {
      setTplAttach(t);
      setFile(null);
    }
    setHash(null);
    setPickerOpen(false);
    setOriginal(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  // Ответ, выбранный в правой колонке шаблонов, — вставляем один раз на каждый клик.
  const appliedNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!pendingTemplate || appliedNonce.current === pendingTemplate.nonce) return;
    appliedNonce.current = pendingTemplate.nonce;
    applyTemplate(pendingTemplate.template);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTemplate]);

  const toggleTranslate = async () => {
    setError('');
    if (original !== null) {
      setText(original);
      setOriginal(null);
      return;
    }
    if (!translationEnabled) return setError('Перевод не настроен');
    if (!writeLang) {
      setError('Язык клиента неизвестен — выберите, на какой язык писать');
      onPickLanguage();
      return;
    }
    const source = text.trim();
    if (!source) return;
    setTranslating(true);
    try {
      const result = await translateDraft(source, writeLang);
      setOriginal(text);
      setText(result.text);
      textareaRef.current?.focus();
    } catch (err) {
      setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось перевести');
    } finally {
      setTranslating(false);
    }
  };

  // Поле растёт вместе с текстом до ~8 строк.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const clearDraft = () => {
    setText('');
    setFile(null);
    setTplAttach(null);
    setError('');
    setOriginal(null);
  };

  const send = useMutation({
    mutationFn: () => sendChatMessage(conversation.id, { text: text.trim() || undefined, file: file ?? undefined, templateId: tplAttach?.id }),
    onSuccess: () => {
      clearDraft();
      onSent();
      textareaRef.current?.focus();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось отправить'),
  });

  const schedule = useMutation({
    mutationFn: () => scheduleMessage(conversation.id, { text: text.trim() || undefined, templateId: tplAttach?.id, sendAt: new Date(scheduleAt).toISOString() }),
    onSuccess: () => {
      clearDraft();
      setScheduleOpen(false);
      queryClient.invalidateQueries({ queryKey: ['chat-scheduled', conversation.id] });
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось запланировать'),
  });

  if (!conversation.canReply) {
    return (
      <div className="shrink-0 px-4 py-3 text-center text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-t border-[#DCE1E8] dark:border-white/10">
        У вас нет права отвечать клиентам этого проекта
      </div>
    );
  }

  const hasContent = text.trim().length > 0 || !!file || !!tplAttach;
  const canSend = hasContent && !send.isPending;
  const submit = () => canSend && send.mutate();

  const openSchedule = () => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    setScheduleAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setScheduleOpen((v) => !v);
  };

  return (
    <div className="shrink-0 border-t border-[#DCE1E8] dark:border-white/10 px-3 py-3">
      <ScheduledList conversationId={conversation.id} />
      {!conversation.project.sendAvailable && (
        <div className="mb-2 text-xs text-amber-700 dark:text-amber-400">
          {conversation.source === 'PERSONAL'
            ? 'Личный аккаунт проекта отключён — сообщение не уйдёт, пока его не подключат заново.'
            : 'Бот проекта сейчас отключён — сообщение не уйдёт, пока его не переподключат.'}
        </div>
      )}
      {error && <div className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</div>}
      {(file || tplAttach) && (
        <div className="mb-2 inline-flex items-center gap-2 max-w-full rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2.5 py-1.5 text-xs text-[#131A24] dark:text-[#E9EDF3]">
          <Paperclip className="w-3.5 h-3.5 shrink-0" />
          {file ? (
            <span className="truncate">{file.name}</span>
          ) : (
            <span className="truncate inline-flex items-center gap-1.5">
              Шаблон #{tplAttach!.code}
              {tplAttach!.messages.length > 1 ? ` · ${tplAttach!.messages.length} сообщений по порядку` : <TemplateKindBadge kind={tplAttach!.mediaKind} />}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setTplAttach(null);
            }}
            className="shrink-0 opacity-60 hover:opacity-100"
            aria-label="Убрать вложение"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div className="relative flex items-end gap-2">
        {pickerOpen && <TemplatePicker projectId={conversation.projectId} resource={chatResourceOf(conversation)} onPick={applyTemplate} onClose={() => setPickerOpen(false)} />}
        {hash && suggestions.length > 0 && (
          <div className="absolute bottom-full left-12 right-24 mb-2 z-30 rounded-xl border border-[#DCE1E8] dark:border-white/10 bg-white dark:bg-[#171F2B] shadow-lg p-1">
            {suggestions.map((t, i) => (
              <button
                key={t.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyTemplate(t);
                }}
                className={cn('w-full text-left rounded-lg px-2.5 py-1.5 flex items-center gap-2', i === hashIndex ? 'bg-[#F3F5F8] dark:bg-white/5' : '')}
              >
                <span className="text-xs font-mono text-[#1F4E9C] dark:text-[#7BA9EE]">#{t.code}</span>
                <span className="text-sm text-[#131A24] dark:text-[#E9EDF3] truncate flex-1">{t.title}</span>
                <TemplateKindBadge kind={t.mediaKind} />
              </button>
            ))}
          </div>
        )}
        {scheduleOpen && (
          <div className="absolute bottom-full right-0 mb-2 z-30 w-72 rounded-xl border border-[#DCE1E8] dark:border-white/10 bg-white dark:bg-[#171F2B] shadow-lg p-3 space-y-2">
            <div className="text-sm font-medium text-[#131A24] dark:text-[#E9EDF3]">Отправить позже</div>
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="w-full h-9 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2 text-sm text-[#131A24] dark:text-[#E9EDF3] outline-none"
            />
            {file && <div className="text-xs text-amber-700 dark:text-amber-400">Файл из поля ввода запланировать нельзя — используйте шаблон с файлом.</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setScheduleOpen(false)} className="h-8 px-3 rounded-lg text-xs text-[#5F6B7A] hover:bg-[#F3F5F8] dark:hover:bg-white/5">
                Отмена
              </button>
              <button
                type="button"
                disabled={!scheduleAt || !!file || !(text.trim() || tplAttach) || schedule.isPending}
                onClick={() => schedule.mutate()}
                className="h-8 px-3 rounded-lg text-xs font-semibold bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] disabled:opacity-40"
              >
                Запланировать
              </button>
            </div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = '';
            if (!picked) return;
            if (picked.size > 20 * 1024 * 1024) {
              setError('Файл больше 20 МБ');
              return;
            }
            setError('');
            setFile(picked);
            setTplAttach(null);
          }}
        />
        <div className="flex flex-col gap-1 shrink-0">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="h-10 w-10 rounded-xl flex items-center justify-center text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-[#F3F5F8] dark:hover:bg-white/5 transition-colors"
            aria-label="Прикрепить файл"
            title="Прикрепить файл"
          >
            <Paperclip className="w-5 h-5" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setScheduleOpen(false);
            // На широком экране шаблоны живут в правой колонке, на узком — панелью над полем ввода.
            if (window.matchMedia('(min-width: 1280px)').matches) onOpenTemplates();
            else setPickerOpen((v) => !v);
          }}
          className={cn(
            'h-10 w-10 shrink-0 rounded-xl flex items-center justify-center transition-colors',
            pickerOpen || templatesInSide ? 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]' : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-[#F3F5F8] dark:hover:bg-white/5',
          )}
          aria-label="Шаблоны ответов"
          title="Шаблоны ответов (или наберите # и код)"
        >
          <BookText className="w-5 h-5" />
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          maxLength={4096}
          onChange={(e) => {
            const value = e.target.value;
            setText(value);
            setOriginal(null);
            // «#код» прямо перед курсором — подсказки шаблонов.
            const caret = e.target.selectionStart ?? value.length;
            const m = value.slice(0, caret).match(HASH_TOKEN);
            setHash(m ? { query: m[1], start: caret - m[1].length - 1 } : null);
            setHashIndex(0);
          }}
          onKeyDown={(e) => {
            if (hash && suggestions.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHashIndex((i) => (i + 1) % suggestions.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHashIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
                e.preventDefault();
                applyTemplate(suggestions[Math.min(hashIndex, suggestions.length - 1)]);
                return;
              }
              if (e.key === 'Escape') {
                setHash(null);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          onBlur={() => setTimeout(() => setHash(null), 150)}
          placeholder="Сообщение… (# — шаблоны, Enter — отправить)"
          className="flex-1 resize-none rounded-xl bg-[#F3F5F8] dark:bg-[#0F1620] px-3.5 py-2.5 text-sm leading-5 text-[#131A24] dark:text-[#E9EDF3] placeholder:text-[#5F6B7A] dark:placeholder:text-[#92A0AF] outline-none focus:ring-2 focus:ring-[#1F4E9C]/30 dark:focus:ring-[#7BA9EE]/30"
        />
        <button
          type="button"
          onClick={toggleTranslate}
          disabled={translating || (original === null && !text.trim())}
          className={cn(
            'h-10 w-10 shrink-0 rounded-xl flex items-center justify-center transition-colors disabled:opacity-40',
            original !== null
              ? 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]'
              : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-[#F3F5F8] dark:hover:bg-white/5',
          )}
          aria-label={original !== null ? 'Вернуть оригинал' : 'Перевести текст'}
          title={
            original !== null
              ? 'Вернуть оригинал'
              : writeLang
                ? `Перевести на ${langLabel(writeLang).toLowerCase()}`
                : 'Перевести (выберите язык клиента)'
          }
        >
          {translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-5 h-5" />}
        </button>
        <button
          type="button"
          onClick={() => {
            openSchedule();
            setPickerOpen(false);
          }}
          disabled={!hasContent}
          className={cn(
            'h-10 w-10 shrink-0 rounded-xl flex items-center justify-center transition-colors disabled:opacity-40',
            scheduleOpen ? 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]' : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-[#F3F5F8] dark:hover:bg-white/5',
          )}
          aria-label="Отправить позже"
          title="Отправить позже"
        >
          <Clock className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          className="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] disabled:opacity-40 transition-opacity"
          aria-label="Отправить"
        >
          {send.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// Запланированные сообщения диалога — серые, над полем ввода; не ушедшие — красные с причиной.
function ScheduledList({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['chat-scheduled', conversationId],
    queryFn: () => fetchScheduled(conversationId),
    refetchInterval: 30_000,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelScheduled(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat-scheduled', conversationId] }),
  });
  if (!data?.length) return null;
  return (
    <div className="mb-2 space-y-1">
      {data.map((m) => (
        <div
          key={m.id}
          className={cn(
            'flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs',
            m.status === 'FAILED' ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200' : 'bg-[#F3F5F8] text-[#5F6B7A] dark:bg-[#0F1620] dark:text-[#92A0AF]',
          )}
        >
          <Clock className="w-3.5 h-3.5 mt-px shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="font-medium tabular-nums">{format(new Date(m.sendAt), 'd MMM, HH:mm', { locale: ru })}</span>
            {m.status === 'SENDING' && ' · отправляется…'}
            {m.status === 'FAILED' && ` · не отправлено: ${m.error ?? ''}`}
            <div className="truncate">
              {m.template && <span className="font-mono">#{m.template.code} </span>}
              {m.text}
            </div>
          </div>
          {(m.status === 'PENDING' || m.status === 'FAILED') && (
            <button type="button" onClick={() => cancel.mutate(m.id)} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Отменить">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
