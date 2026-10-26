import { api } from '@/lib/api';

// Встроенный чат (запрос пользователя 2026-10-23) — см. ChatController на бэкенде.

// BOT — переписка через бота проекта, PERSONAL — через подключённый личный аккаунт.
export type ChatSource = 'BOT' | 'PERSONAL';

export const CHAT_SOURCE_LABEL: Record<ChatSource, string> = { BOT: 'Бот', PERSONAL: 'Личка' };

// Видит ли пользователь чаты вообще (2026-10-24) — только подсказка для UI, реальная проверка на
// бэкенде (ChatService.chatScope). Баеру чаты закрыты всегда; chatAccess отсутствует у сессии,
// начатой до появления поля, — тогда считаем его дефолтом ALL, как и в базе.
export function canUseChats(user: { role: string; chatAccess?: string } | null | undefined): boolean {
  if (!user || user.role === 'BUYER') return false;
  if (user.role === 'OWNER' || user.role === 'SUPER_ADMIN') return true;
  return (user.chatAccess ?? 'ALL') !== 'NONE';
}

export interface ChatProject {
  id: string;
  name: string;
  folderId: string | null; // папка проекта (2026-10-25)
  favorite: boolean;
  channelId: string;
  hasAvatar: boolean;
  bot: { username: string | null; active: boolean; unread: number } | null;
  personal: { username: string | null; unread: number } | null;
}

export interface ConversationListItem {
  id: string;
  projectId: string;
  projectName: string;
  clientId: string | null;
  peerId: string;
  // '' — основной бот, иначе id дополнительного бота; botUsername — его @ (2026-10-24).
  botKey: string;
  botUsername: string | null;
  peerFirstName: string | null;
  peerLastName: string | null;
  peerUsername: string | null;
  lastMessageAt: string;
  lastMessageText: string | null;
  lastMessageDirection: 'IN' | 'OUT' | null;
  unreadCount: number;
  lastError: string | null;
  hasAvatar: boolean;
  hasPurchase: boolean | null;
  isBotActive: boolean | null;
  // Ответственный оператор (2026-10-25).
  assignedUserId: string | null;
  assigneeFirstName: string | null;
  assigneeLastName: string | null;
  // Статус, избранное, теги (2026-10-25).
  status: ChatStatus;
  favorite: boolean;
  tags: ChatTag[];
  stageId: string | null;
  pinned: boolean; // закреплён у текущего сотрудника (2026-10-25)
  trafficSource?: 'FB' | 'TT' | null; // площадка по клику рекламы (2026-10-26)
}

export type ChatStatus = 'OPEN' | 'WAITING' | 'FINISHED';
export const CHAT_STATUS_LABEL: Record<ChatStatus, string> = { OPEN: 'В работе', WAITING: 'Ждём ответа', FINISHED: 'Завершён' };

export interface ChatTag {
  id: string;
  name: string;
  color: string;
}

// Вкладки над списком диалогов (как в Chatterfy).
export type ChatTab = 'all' | 'unread' | 'unanswered' | 'waiting' | 'finished' | 'favorites' | 'blocked';
export const CHAT_TABS: { value: ChatTab; label: string; hint: string }[] = [
  { value: 'all', label: 'Все', hint: 'Все диалоги' },
  { value: 'unread', label: 'Непрочитанные', hint: 'Есть непрочитанные сообщения' },
  { value: 'unanswered', label: 'Без ответа', hint: 'Последнее сообщение от лида, диалог не завершён' },
  { value: 'waiting', label: 'Ждём ответа', hint: 'Статус «Ждём ответа»' },
  { value: 'finished', label: 'Завершены', hint: 'Статус «Завершён»' },
  { value: 'favorites', label: 'Избранное', hint: 'Ваши избранные диалоги' },
  { value: 'blocked', label: 'Заблокировали', hint: 'Лид заблокировал бота' },
];

export const TAG_COLORS = ['#1F4E9C', '#1F7A6C', '#B45309', '#B91C1C', '#7C3AED', '#DB2777', '#0E7490', '#4D7C0F', '#64748B'];

export interface ConversationFilters {
  assignee?: string;
  tab?: ChatTab;
  tagIds?: string[];
  from?: string;
  to?: string;
  purchase?: 'yes' | 'no' | '';
  traffic?: 'FB' | 'TT' | 'none' | ''; // источник трафика лида (2026-10-26)
  fieldId?: string;
  fieldValue?: string;
  stage?: string;
}

function filterParams(f: ConversationFilters) {
  return {
    assignee: f.assignee || undefined,
    tab: f.tab && f.tab !== 'all' ? f.tab : undefined,
    tags: f.tagIds?.length ? f.tagIds.join(',') : undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    purchase: f.purchase || undefined,
    traffic: f.traffic || undefined,
    field: f.fieldId && f.fieldValue?.trim() ? f.fieldId : undefined,
    fieldValue: f.fieldId && f.fieldValue?.trim() ? f.fieldValue.trim() : undefined,
    stage: f.stage || undefined,
  };
}

export interface ConversationDetail {
  id: string;
  projectId: string;
  source: ChatSource;
  clientId: string | null;
  peerId: string;
  peerFirstName: string | null;
  peerLastName: string | null;
  peerUsername: string | null;
  lastError: string | null;
  botKey: string;
  // Язык Telegram клиента (2 буквы) — для «Писать на: авто» в переводчике.
  clientLanguage: string | null;
  project: { id: string; name: string; botUsername: string | null; personalUsername: string | null; sendAvailable: boolean };
  canReply: boolean;
  assignee: { id: string; name: string } | null;
  canAssign: boolean; // тимлид/админ/владелец — может передавать чат
  canReturn: boolean; // оператор, которому чат назначен, — может вернуть тимлиду
  status: ChatStatus;
  favorite: boolean;
  tags: ChatTag[];
  customFields: Record<string, unknown> | null;
  // «Скрытый оператор» — личные данные лида скрыты сервером (2026-10-25).
  anonymous: boolean;
  // Заметка о лиде (2026-10-25).
  note: string | null;
  stageId: string | null;
  pinned: boolean;
  trafficSource?: 'FB' | 'TT' | null; // площадка по клику рекламы (2026-10-26)
}

export type ChatMediaType = 'photo' | 'video' | 'voice' | 'video_note' | 'audio' | 'document' | 'sticker' | 'animation';

export interface ChatMessage {
  id: string;
  direction: 'IN' | 'OUT';
  senderType: 'CLIENT' | 'OPERATOR' | 'BOT' | 'SYSTEM';
  senderUserId: string | null;
  senderName: string | null;
  text: string | null;
  mediaType: ChatMediaType | null;
  mediaFileName: string | null;
  error: string | null;
  // Уже сделанные переводы: язык → текст и язык оригинала (2026-10-24).
  translations: Record<string, ChatTranslation> | null;
  // Удалено из Telegram из CRM (2026-10-26): в CRM остаётся с пометкой, кто удалил.
  deletedAt?: string | null;
  deletedByName?: string | null;
  canDelete?: boolean;
  // Возможности Telegram (2026-10-26): ответ с цитатой, пересланное, правка.
  replyTo?: { id: string; direction: 'IN' | 'OUT'; text: string | null; mediaType: ChatMediaType | null } | null;
  forwardedFrom?: string | null;
  editedAt?: string | null;
  originalText?: string | null;
  canReply?: boolean;
  canEdit?: boolean;
  createdAt: string;
}

export async function editChatMessage(id: string, text: string) {
  await api.patch(`/chat/messages/${id}`, { text });
}

export async function sendTypingSignal(conversationId: string) {
  await api.post(`/chat/conversations/${conversationId}/typing`);
}

export async function deleteChatMessage(id: string) {
  await api.delete(`/chat/messages/${id}`);
}

export interface ChatTranslation {
  text: string;
  from: string | null;
}

export function peerDisplayName(c: { peerFirstName: string | null; peerLastName: string | null; peerUsername: string | null; peerId: string }): string {
  const name = [c.peerFirstName, c.peerLastName].filter(Boolean).join(' ').trim();
  return name || (c.peerUsername ? `@${c.peerUsername}` : `ID ${c.peerId}`);
}

export async function fetchConversations(
  params: {
    projectId?: string;
    source?: ChatSource;
    unread?: boolean;
    search?: string;
    before?: string;
  } & ConversationFilters,
) {
  const { data } = await api.get<{ items: ConversationListItem[]; hasMore: boolean }>('/chat/conversations', {
    params: {
      projectId: params.projectId || undefined,
      source: params.source,
      unread: params.unread ? 'true' : undefined,
      search: params.search || undefined,
      before: params.before,
      ...filterParams(params),
    },
  });
  return data;
}

export async function fetchMessages(conversationId: string, before?: string) {
  const { data } = await api.get<{ items: ChatMessage[]; hasMore: boolean }>(`/chat/conversations/${conversationId}/messages`, {
    params: { before },
  });
  return data;
}

export async function sendChatMessage(conversationId: string, payload: { text?: string; file?: File; templateId?: string; replyToId?: string }) {
  const form = new FormData();
  if (payload.replyToId) form.append('replyToId', payload.replyToId);
  if (payload.text) form.append('text', payload.text);
  if (payload.file) form.append('file', payload.file);
  else if (payload.templateId) form.append('templateId', payload.templateId);
  const { data } = await api.post<ChatMessage>(`/chat/conversations/${conversationId}/messages`, form);
  return data;
}

// Открыть переписку с клиентом из его карточки — возвращает id диалога.
export async function openClientChat(projectId: string, clientId: string, source?: ChatSource): Promise<string> {
  const { data } = await api.post<{ id: string }>('/chat/conversations/open', { projectId, clientId, source });
  return data.id;
}

export function chatHref(projectId: string, source?: ChatSource, conversationId?: string): string {
  const params = new URLSearchParams({ project: projectId });
  if (source) params.set('source', source);
  if (conversationId) params.set('c', conversationId);
  return `/chats?${params}`;
}

// Файлы переписки отдаются только с Bearer-токеном — тот же blob-приём, что у аватаров клиентов.
const mediaCache = new Map<string, Promise<string>>();
export function loadChatMedia(messageId: string): Promise<string> {
  let pending = mediaCache.get(messageId);
  if (!pending) {
    pending = api
      .get(`/chat/messages/${messageId}/media`, { responseType: 'blob' })
      .then((res) => URL.createObjectURL(res.data as Blob));
    pending.catch(() => mediaCache.delete(messageId));
    mediaCache.set(messageId, pending);
  }
  return pending;
}

// ---- перевод (2026-10-24) ----

// Совпадает с TRANSLATION_LANGUAGES на бэкенде.
export const TRANSLATION_LANGS: { code: string; label: string }[] = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'Английский' },
  { code: 'es', label: 'Испанский' },
  { code: 'pt', label: 'Португальский' },
  { code: 'uk', label: 'Украинский' },
  { code: 'de', label: 'Немецкий' },
  { code: 'fr', label: 'Французский' },
  { code: 'it', label: 'Итальянский' },
  { code: 'tr', label: 'Турецкий' },
  { code: 'pl', label: 'Польский' },
  { code: 'id', label: 'Индонезийский' },
  { code: 'zh', label: 'Китайский' },
];

export function langLabel(code: string | null | undefined): string {
  if (!code) return '';
  return TRANSLATION_LANGS.find((l) => l.code === code)?.label ?? code.toUpperCase();
}

// Языки переводчика — у каждого пользователя свои, отдельно на каждый бот/личку проекта
// (запрос пользователя: «все могут менять язык для себя»). Хранятся в браузере.
export interface TranslatePrefs {
  read: string; // на какой язык переводить сообщения переписки
  write: string; // 'auto' — язык клиента из Telegram, иначе код языка
}

const DEFAULT_PREFS: TranslatePrefs = { read: 'ru', write: 'auto' };

function prefsKey(userId: string, c: { projectId: string; source: ChatSource; botKey: string }) {
  return `chat-translate:${userId}:${c.projectId}:${c.source}:${c.botKey}`;
}

export function loadTranslatePrefs(userId: string, c: { projectId: string; source: ChatSource; botKey: string }): TranslatePrefs {
  try {
    const raw = localStorage.getItem(prefsKey(userId, c));
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<TranslatePrefs>) };
  } catch {
    // нет доступа к localStorage — работаем на значениях по умолчанию
  }
  return DEFAULT_PREFS;
}

export function saveTranslatePrefs(userId: string, c: { projectId: string; source: ChatSource; botKey: string }, prefs: TranslatePrefs) {
  try {
    localStorage.setItem(prefsKey(userId, c), JSON.stringify(prefs));
  } catch {
    // не сохранилось — выбор действует до перезагрузки
  }
}

export async function translateChatMessage(messageId: string, lang: string) {
  const { data } = await api.post<ChatTranslation & { lang: string }>(`/chat/messages/${messageId}/translate`, { lang });
  return data;
}

export async function translateDraft(text: string, lang: string) {
  const { data } = await api.post<ChatTranslation & { lang: string }>('/chat/translate', { text, lang });
  return data;
}

// ---- ответственные за диалоги (2026-10-25) ----

export function assigneeName(c: { assigneeFirstName: string | null; assigneeLastName: string | null }): string {
  return [c.assigneeFirstName, c.assigneeLastName].filter(Boolean).join(' ');
}

// userId = null — снять ответственного (у оператора — вернуть чат тимлиду).
export async function assignConversations(ids: string[], userId: string | null) {
  const { data } = await api.post<{ changed: number }>('/chat/conversations/assign', { ids, userId });
  return data;
}

export interface ChatOperator {
  id: string;
  name: string;
  email: string;
  onProject: boolean;
  isActive: boolean;
}

export interface ChatAccessData {
  resources: { key: string; kind: 'BOT' | 'EXTRA_BOT' | 'PERSONAL'; title: string; connected: boolean }[];
  operators: ChatOperator[];
  // Удалённые/заблокированные, за которыми ещё числятся диалоги проекта (2026-10-26).
  formerOperators?: { id: string; name: string; deleted: boolean; chats: number }[];
  assignments: { resource: string; userId: string }[];
  autoAssign: { resource: string; userId: string; weight: number }[];
}

export async function fetchChatAccess(projectId: string) {
  return (await api.get<ChatAccessData>(`/chat/projects/${projectId}/access`)).data;
}

// ---- вкладки, теги, статус, избранное (2026-10-25) ----

export async function fetchTabCounts(params: { projectId: string; source: ChatSource } & ConversationFilters) {
  const { data } = await api.get<Record<ChatTab, number>>('/chat/conversations/counts', {
    params: { projectId: params.projectId, source: params.source, ...filterParams({ ...params, tab: undefined }) },
  });
  return data;
}

// Ресурс чата (2026-10-25: у бота и лички свои настройки): 'BOT' | 'BOT:<id>' | 'PERSONAL'.
export function chatResourceOf(c: { source: ChatSource; botKey?: string | null }): string {
  if (c.source === 'PERSONAL') return 'PERSONAL';
  return c.botKey ? `BOT:${c.botKey}` : 'BOT';
}

export async function fetchChatTags(projectId: string, resource: string) {
  return (await api.get<(ChatTag & { count: number })[]>(`/chat/projects/${projectId}/tags`, { params: { resource } })).data;
}

export async function createChatTag(projectId: string, resource: string, name: string, color: string) {
  return (await api.post<ChatTag>(`/chat/projects/${projectId}/tags`, { name, color, resource })).data;
}

export async function updateChatTag(projectId: string, tagId: string, data: { name?: string; color?: string }) {
  return (await api.patch<ChatTag>(`/chat/projects/${projectId}/tags/${tagId}`, data)).data;
}

export async function deleteChatTag(projectId: string, tagId: string) {
  await api.delete(`/chat/projects/${projectId}/tags/${tagId}`);
}

export async function setConversationTags(conversationId: string, tagIds: string[]) {
  return (await api.put<ChatTag[]>(`/chat/conversations/${conversationId}/tags`, { tagIds })).data;
}

export async function setConversationStatus(conversationId: string, status: ChatStatus) {
  await api.put(`/chat/conversations/${conversationId}/status`, { status });
}

export async function setConversationFavorite(conversationId: string, favorite: boolean) {
  await api.put(`/chat/conversations/${conversationId}/favorite`, { favorite });
}

// ---- шаблоны ответов (2026-10-25) ----

export type TemplateMediaKind = 'photo' | 'video' | 'document' | 'voice' | 'video_note';
export const TEMPLATE_KIND_LABEL: Record<TemplateMediaKind, string> = {
  photo: 'Фото',
  video: 'Видео',
  document: 'Документ',
  voice: 'Голосовое',
  video_note: 'Кружок',
};

// Одно сообщение цепочки шаблона (2026-10-25: шаблон может отправлять сразу несколько сообщений).
export interface ChatTemplateMessage {
  id: string;
  text: string | null;
  mediaKind: TemplateMediaKind | null;
  mediaFileName: string | null;
}

export interface ChatTemplate {
  id: string;
  folderId: string;
  code: string;
  title: string;
  // Сводка — первое сообщение (для поиска и подсказок «#код»).
  text: string | null;
  mediaKind: TemplateMediaKind | null;
  mediaFileName: string | null;
  messages: ChatTemplateMessage[];
}

export interface ChatTemplateFolder {
  id: string;
  name: string;
  projectId: string | null; // null — общая папка компании
  canEdit: boolean;
  templates: ChatTemplate[];
}

export interface ChatTemplatesData {
  canManageProject: boolean;
  canManageCompany: boolean;
  folders: ChatTemplateFolder[];
}

export async function fetchChatTemplates(projectId: string, resource: string) {
  return (await api.get<ChatTemplatesData>('/chat/templates', { params: { projectId, resource } })).data;
}

export async function createTemplateFolder(name: string, projectId: string | null, resource: string) {
  return (await api.post('/chat/template-folders', { name, projectId: projectId ?? undefined, resource })).data;
}

export async function renameTemplateFolder(id: string, name: string) {
  await api.patch(`/chat/template-folders/${id}`, { name });
}

export async function deleteTemplateFolder(id: string) {
  await api.delete(`/chat/template-folders/${id}`);
}

// Сообщение цепочки в форме шаблона: keepMedia — оставить прежний файл сохранённого сообщения.
export interface TemplateMessageForm {
  key: string; // ключ строки в форме
  id?: string; // id сохранённого сообщения
  text: string;
  mediaKind: '' | TemplateMediaKind;
  keepMedia: boolean;
  existing?: ChatTemplateMessage;
  file?: File | null;
}

export interface TemplateForm {
  folderId: string;
  code: string;
  title: string;
  messages: TemplateMessageForm[];
}

function templateFormData(f: TemplateForm) {
  const form = new FormData();
  form.append('folderId', f.folderId);
  form.append('code', f.code);
  form.append('title', f.title);
  const messages = f.messages.map((m, i) => {
    if (m.file) form.append(`file_${i}`, m.file);
    return { id: m.id, text: m.text, mediaKind: m.file ? m.mediaKind : '', keepMedia: !m.file && m.keepMedia, fileField: m.file ? `file_${i}` : undefined };
  });
  form.append('messages', JSON.stringify(messages));
  return form;
}

export async function createChatTemplate(f: TemplateForm) {
  return (await api.post('/chat/templates', templateFormData(f))).data;
}

export async function updateChatTemplate(id: string, f: TemplateForm) {
  return (await api.patch(`/chat/templates/${id}`, templateFormData(f))).data;
}

export async function deleteChatTemplate(id: string) {
  await api.delete(`/chat/templates/${id}`);
}

export async function loadTemplateMedia(templateId: string): Promise<string> {
  const res = await api.get(`/chat/templates/${templateId}/media`, { responseType: 'blob' });
  return URL.createObjectURL(res.data as Blob);
}

export async function loadTemplateMessageMedia(messageId: string): Promise<string> {
  const res = await api.get(`/chat/template-messages/${messageId}/media`, { responseType: 'blob' });
  return URL.createObjectURL(res.data as Blob);
}

// ---- отложенные сообщения (2026-10-25) ----

export interface ScheduledMessage {
  id: string;
  text: string | null;
  templateId: string | null;
  template: { id: string; title: string; code: string; mediaKind: TemplateMediaKind | null } | null;
  sendAt: string;
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
  error: string | null;
}

export async function fetchScheduled(conversationId: string) {
  return (await api.get<ScheduledMessage[]>(`/chat/conversations/${conversationId}/scheduled`)).data;
}

export async function scheduleMessage(conversationId: string, payload: { text?: string; templateId?: string; sendAt: string }) {
  return (await api.post(`/chat/conversations/${conversationId}/scheduled`, payload)).data;
}

export async function cancelScheduled(id: string) {
  await api.delete(`/chat/scheduled/${id}`);
}

// ---- свои поля лида (2026-10-25) ----

export type ChatFieldType = 'TEXT' | 'LONG_TEXT' | 'LINK' | 'NUMBER' | 'DATE' | 'SELECT' | 'MULTISELECT';
export const CHAT_FIELD_TYPE_LABEL: Record<ChatFieldType, string> = {
  TEXT: 'Текст',
  LONG_TEXT: 'Длинный текст',
  LINK: 'Ссылка',
  NUMBER: 'Число',
  DATE: 'Дата',
  SELECT: 'Выбор из списка',
  MULTISELECT: 'Несколько из списка',
};

export interface ChatField {
  id: string;
  name: string;
  type: ChatFieldType;
  options: string[];
}

export async function fetchChatFields(projectId: string, resource: string) {
  return (await api.get<{ canManage: boolean; fields: ChatField[] }>(`/chat/projects/${projectId}/fields`, { params: { resource } })).data;
}

export async function createChatField(projectId: string, resource: string, data: { name: string; type: ChatFieldType; options?: string[] }) {
  return (await api.post<ChatField>(`/chat/projects/${projectId}/fields`, { ...data, resource })).data;
}

export async function updateChatField(projectId: string, fieldId: string, data: { name?: string; options?: string[] }) {
  return (await api.patch<ChatField>(`/chat/projects/${projectId}/fields/${fieldId}`, data)).data;
}

export async function deleteChatField(projectId: string, fieldId: string) {
  await api.delete(`/chat/projects/${projectId}/fields/${fieldId}`);
}

export async function setChatFieldValues(conversationId: string, values: Record<string, unknown>) {
  return (await api.put<Record<string, unknown>>(`/chat/conversations/${conversationId}/fields`, { values })).data;
}

// ---- папки и избранные проекты (2026-10-25) ----

export interface ProjectFolder {
  id: string;
  name: string;
}

export async function fetchProjectFolders() {
  return (await api.get<ProjectFolder[]>('/chat/project-folders')).data;
}

export async function createProjectFolder(name: string) {
  return (await api.post<ProjectFolder>('/chat/project-folders', { name })).data;
}

export async function renameProjectFolder(id: string, name: string) {
  await api.patch(`/chat/project-folders/${id}`, { name });
}

export async function deleteProjectFolder(id: string) {
  await api.delete(`/chat/project-folders/${id}`);
}

export async function setProjectFolder(projectId: string, folderId: string | null) {
  await api.put(`/chat/projects/${projectId}/folder`, { folderId });
}

export async function setProjectFavorite(projectId: string, favorite: boolean) {
  await api.put(`/chat/projects/${projectId}/favorite`, { favorite });
}

export async function setConversationNote(conversationId: string, note: string) {
  return (await api.put<{ note: string | null }>(`/chat/conversations/${conversationId}/note`, { note })).data;
}

// ---- этапы лида (2026-10-25) ----

export type ChatStageTrigger = 'MANUAL' | 'NEW_CHAT' | 'FIRST_PURCHASE' | 'REPEAT_PURCHASE' | 'TAG' | 'FIELD';
export const STAGE_TRIGGER_LABEL: Record<ChatStageTrigger, string> = {
  MANUAL: 'Только вручную',
  NEW_CHAT: 'Новый диалог',
  FIRST_PURCHASE: 'Первая покупка (FD)',
  REPEAT_PURCHASE: 'Повторная покупка (RD)',
  TAG: 'Поставлен тег',
  FIELD: 'Поле получило значение',
};

export interface ChatStage {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  trigger: ChatStageTrigger;
  purchaseNumber: number | null;
  tagId: string | null;
  fieldId: string | null;
  fieldValue: string | null;
  operators: { userId: string; weight: number }[];
  count: number;
}

export interface StageInput {
  name: string;
  color: string;
  trigger: ChatStageTrigger;
  purchaseNumber: number | null;
  tagId: string | null;
  fieldId: string | null;
  fieldValue: string | null;
  operators: { userId: string; weight: number }[];
}

export async function fetchChatStages(projectId: string, resource: string) {
  return (await api.get<{ canManage: boolean; stages: ChatStage[] }>(`/chat/projects/${projectId}/stages`, { params: { resource } })).data;
}

export async function createChatStage(projectId: string, resource: string, data: StageInput) {
  return (await api.post(`/chat/projects/${projectId}/stages`, { ...data, resource })).data;
}

export async function updateChatStage(projectId: string, stageId: string, data: StageInput) {
  return (await api.put(`/chat/projects/${projectId}/stages/${stageId}`, data)).data;
}

export async function deleteChatStage(projectId: string, stageId: string) {
  await api.delete(`/chat/projects/${projectId}/stages/${stageId}`);
}

export async function reorderChatStages(projectId: string, resource: string, ids: string[]) {
  await api.put(`/chat/projects/${projectId}/stages-order`, { ids, resource });
}

export async function applyChatStage(projectId: string, stageId: string) {
  return (await api.post<{ moved: number }>(`/chat/projects/${projectId}/stages/${stageId}/apply`)).data;
}

export async function setConversationStage(conversationId: string, stageId: string | null) {
  await api.put(`/chat/conversations/${conversationId}/stage`, { stageId });
}

// ---- рассылка из чата (2026-10-25) ----

export interface BroadcastFilter {
  projectId: string;
  source: ChatSource;
  search?: string;
}

function broadcastFilterBody(f: BroadcastFilter & ConversationFilters) {
  const p = filterParams(f);
  return {
    projectId: f.projectId,
    source: f.source,
    search: f.search || undefined,
    assignee: p.assignee,
    tab: p.tab,
    tags: p.tags,
    from: p.from,
    to: p.to,
    purchase: p.purchase,
    traffic: p.traffic,
    field: p.field,
    fieldValue: p.fieldValue,
    stage: p.stage,
  };
}

export async function countBroadcastRecipients(filter: BroadcastFilter & ConversationFilters, conversationIds?: string[]) {
  return (await api.post<{ count: number }>('/chat/broadcasts/count', { filter: broadcastFilterBody(filter), conversationIds })).data.count;
}

export interface BroadcastPartInput {
  text?: string;
  mediaKind?: TemplateMediaKind;
  mediaKey?: string;
  mediaFileName?: string;
  mediaMime?: string;
}

export interface BroadcastVariantInput {
  text?: string;
  templateId?: string;
  parts?: BroadcastPartInput[]; // свои сообщения с файлами (2026-10-26)
}

// Файл для варианта рассылки загружается сразу; войс и кружок сервер перекодирует.
export async function uploadBroadcastMedia(projectId: string, file: File, mediaKind?: TemplateMediaKind) {
  const form = new FormData();
  form.append('projectId', projectId);
  if (mediaKind) form.append('mediaKind', mediaKind);
  form.append('file', file);
  return (await api.post<{ mediaKind: TemplateMediaKind; mediaKey: string; mediaFileName: string; mediaMime: string }>('/chat/broadcast-media', form)).data;
}

export async function createChatBroadcast(
  filter: BroadcastFilter & ConversationFilters,
  payload: {
    conversationIds?: string[];
    text?: string;
    templateId?: string;
    variants?: BroadcastVariantInput[];
    delayMinSec?: number;
    delayMaxSec?: number;
    sendAt?: string;
  },
) {
  return (await api.post('/chat/broadcasts', { filter: broadcastFilterBody(filter), ...payload })).data;
}

export interface ChatBroadcastRow {
  id: string;
  text: string | null;
  template: { id: string; code: string; title: string } | null;
  sendAt: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'CANCELLED';
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
  finishedAt: string | null;
  createdByName: string | null;
  variants: { text: string | null; template: { id: string; code: string; title: string } | null; parts?: { text: string | null; mediaKind: TemplateMediaKind | null }[] }[];
  delayMinSec: number | null;
  delayMaxSec: number | null;
}

export async function fetchChatBroadcasts(projectId: string, source: ChatSource) {
  return (await api.get<ChatBroadcastRow[]>(`/chat/projects/${projectId}/broadcasts`, { params: { source } })).data;
}

export async function cancelChatBroadcast(id: string) {
  await api.post(`/chat/broadcasts/${id}/cancel`);
}

export async function setConversationPinned(conversationId: string, pinned: boolean) {
  await api.put(`/chat/conversations/${conversationId}/pin`, { pinned });
}

// ---- «Кто ведёт лидов» над чатами (2026-10-25) ----

export interface DistributionData {
  resource: 'BOT' | 'PERSONAL';
  newChats:
    | { kind: 'stage'; stageId: string; stageName: string; operators: { userId: string; weight: number }[] }
    | { kind: 'auto'; operators: { userId: string; weight: number }[] };
  stages: { id: string; name: string; color: string; trigger: ChatStageTrigger; purchaseNumber: number | null; operators: { userId: string; weight: number }[] }[];
  operators: { id: string; name: string; isActive: boolean; onProject: boolean; activeChats: number }[];
}

export async function fetchDistribution(projectId: string, source: ChatSource) {
  return (await api.get<DistributionData>(`/chat/projects/${projectId}/distribution`, { params: { source } })).data;
}

export async function saveAutoAssign(projectId: string, resource: string, rules: { userId: string; weight: number }[]) {
  await api.put(`/chat/projects/${projectId}/auto-assign`, { resource, rules });
}

export async function saveStageOperators(projectId: string, stageId: string, operators: { userId: string; weight: number }[]) {
  await api.put(`/chat/projects/${projectId}/stages/${stageId}/operators`, { operators });
}

// ---- перенос настроек чата (2026-10-25) ----

export interface CopySettingsInput {
  fromProjectId: string;
  fromResource: string;
  toProjectId: string;
  toResource: string;
  tags: boolean;
  fields: boolean;
  stages: boolean;
  templates: boolean;
  distribution: boolean;
}

export async function copyChatSettings(input: CopySettingsInput) {
  return (await api.post<{ tags: number; fields: number; stages: number; templates: number; distribution: number }>('/chat/settings/copy', input)).data;
}

// ---- передать все чаты оператора (2026-10-26) ----

export interface TransferSummary {
  from: { id: string; name: string };
  total: number;
  hidden: number; // в проектах, где спрашивающий не управляет операторами
  groups: { projectId: string; projectName: string; source: ChatSource; count: number }[];
  operators: { id: string; name: string }[];
}

export async function fetchTransferSummary(userId: string) {
  return (await api.get<TransferSummary>(`/chat/transfer/${userId}/summary`)).data;
}

// targets пустой — снять ответственного.
export async function transferChats(input: { fromUserId: string; projectId?: string; source?: ChatSource; targets: { userId: string; weight: number }[] }) {
  return (await api.post<{ changed: number }>('/chat/transfer', input)).data;
}
