// Общие типы для сценариев бота — используются и списком (/scenarios), и редактором
// (/scenarios/[id]). Зеркалит apps/api/src/modules/channels/dto/bot-scenario*.dto.ts.
// Объединение с автоворонками (запрос пользователя 2026-07-22): общая идея шагов
// (DELAY/SEND_MESSAGE/CONDITION), но отдельные таблицы — см. AutomationStep в automations.ts,
// это НЕ то же самое, отдельный движок (BotScenarioEngineService), может срабатывать повторно.
//
// Редизайн 2026-07-25 (запрос пользователя): редактор больше не показывает сырые шаги
// (DELAY/SEND_MESSAGE/CONDITION) — только "элементы" (ScenarioElement), один тип контента +
// кнопка на элемент, задержка — поле внутри самого элемента. На бэкенде элемент по-прежнему
// 1-2 реальных BotScenarioStep (см. BotScenariosService.groupSteps) — эта пара-под-капотом
// полностью скрыта здесь, фронтенд про неё не знает.

import type { LucideIcon } from 'lucide-react';
import { Bell, Circle, Image, Images, MessageSquare, Mic, Repeat, Sparkles, Terminal, UserMinus, UserPlus, Video } from 'lucide-react';

export const SCENARIO_TRIGGER_TYPES = ['SUBSCRIBE', 'FIRST_DEPOSIT', 'REPEAT_DEPOSIT', 'UNSUBSCRIBE', 'DEFAULT', 'COMMAND'] as const;
export type ScenarioTriggerType = (typeof SCENARIO_TRIGGER_TYPES)[number];

// SUBSCRIBE — запрос пользователя 2026-07-25: приветственное сообщение при подписке (раньше
// отдельное поле Channel.tgWelcomeMessage* в настройках бота) переехало сюда, обычным
// сценарием, тем же движком, что и остальные триггеры. Срабатывает в момент одобрения заявки
// на вступление (только PRIVATE_CHANNEL_REQUEST — см. bot-settings-tab.tsx).
export const SINGLETON_TRIGGERS: { value: ScenarioTriggerType; title: string; description: string }[] = [
  { value: 'SUBSCRIBE', title: 'Подписка', description: 'Срабатывает при одобрении заявки на вступление в канал.' },
  { value: 'FIRST_DEPOSIT', title: 'Первый депозит (FD)', description: 'Срабатывает один раз при первой покупке клиента.' },
  { value: 'REPEAT_DEPOSIT', title: 'Повторный депозит (RD)', description: 'Срабатывает при каждой следующей покупке клиента.' },
  { value: 'UNSUBSCRIBE', title: 'Отписка', description: 'Срабатывает, когда клиент покидает канал/блокирует бота.' },
  { value: 'DEFAULT', title: 'По умолчанию', description: 'Срабатывает на любое сообщение, не подошедшее под другие сценарии.' },
];

export const TRIGGER_TYPE_LABEL: Record<ScenarioTriggerType, string> = {
  SUBSCRIBE: 'Подписка',
  FIRST_DEPOSIT: 'Первый депозит',
  REPEAT_DEPOSIT: 'Повторный депозит',
  UNSUBSCRIBE: 'Отписка',
  DEFAULT: 'По умолчанию',
  COMMAND: 'Команда',
};

// Иконка на карточку сценария (запрос пользователя 2026-07-25, "добавь для каждого сценария
// какую-то иконку чтобы было понятнее и красивее") — по типу триггера, не по конкретному
// сценарию: одинаковый смысл у всех сценариев одного триггера (все FD выглядят одинаково и т.п.).
export const TRIGGER_TYPE_ICON: Record<ScenarioTriggerType, LucideIcon> = {
  SUBSCRIBE: UserPlus,
  FIRST_DEPOSIT: Sparkles,
  REPEAT_DEPOSIT: Repeat,
  UNSUBSCRIBE: UserMinus,
  DEFAULT: Bell,
  COMMAND: Terminal,
};

export type ScenarioMediaType = 'photo' | 'video' | 'video_note' | 'voice';

export interface ScenarioMediaItem {
  type: ScenarioMediaType;
  url: string;
}

export interface ScenarioButton {
  text: string;
  url: string;
}

// Элемент — единица контента в редакторе (см. комментарий вверху файла). delaySeconds=0 значит
// "без задержки, отправить сразу вслед за предыдущим элементом".
export interface ScenarioElement {
  id: string;
  delaySeconds: number;
  messageText: string | null;
  messageMedia: ScenarioMediaItem[] | null;
  buttons: ScenarioButton[] | null;
}

// Разбивка ранов сценария по статусам (запрос пользователя 2026-07-25: "сколько успешно,
// сколько в ожидании, сколько ошибка" + отдельный счётчик прерванных условием — EXITED больше
// не создаётся новым редактором, но встречается у старых легаси-цепочек с CONDITION-шагом).
export interface RunStatusCounts {
  active: number;
  completed: number;
  exited: number;
  failed: number;
}

export const RUN_STATUS_LABEL: Record<keyof RunStatusCounts, string> = {
  active: 'В ожидании',
  completed: 'Успешно',
  exited: 'Прервано',
  failed: 'Ошибка',
};

export interface BotScenarioListItem {
  id: string;
  channelId: string;
  triggerType: ScenarioTriggerType;
  command: string | null;
  isActive: boolean;
  stepCount: number;
  runCount: number;
  runCounts: RunStatusCounts;
  elementTypes: ElementContentType[];
  abTestGroupId: string | null;
  abTestEndedAt: string | null;
}

export type ScenarioRunStatus = 'ACTIVE' | 'COMPLETED' | 'EXITED' | 'FAILED';

export interface ScenarioRunListItem {
  id: string;
  tgUserId: string;
  clientId: string | null;
  clientName: string | null;
  clientUsername: string | null;
  status: ScenarioRunStatus;
  startedAt: string;
  completedAt: string | null;
}

export interface ScenarioStats {
  counts: RunStatusCounts;
  total: number;
  runs: ScenarioRunListItem[];
}

export interface BotScenarioDetail {
  id: string;
  channelId: string;
  triggerType: ScenarioTriggerType;
  command: string | null;
  isActive: boolean;
  firstStepId: string | null;
  elements: ScenarioElement[];
  abTestGroupId: string | null;
  abTestWeight: number | null;
  isAbTestVariant: boolean;
}

// A/B-тест сценариев (запрос пользователя 2026-07-25, "как мы сделали для груп лэндингов") —
// тот же принцип, что группы лендингов (endedAt+resultsSnapshot вместо удаления), но без
// привязки варианта к клиенту: при каждом срабатывании триггера вариант выбирается заново
// взвешенным рандомом (согласовано с пользователем явно). Метрики — снимок ТЕКУЩЕГО состояния
// клиентов, получивших вариант (проект не трекает прочтение конкретных сообщений бота), не
// точная конверсия — только прокси для сравнения вариантов между собой.
export interface AbTestVariantStat {
  scenarioId: string;
  isAbTestVariant: boolean;
  isActive: boolean;
  weight: number;
  received: number;
  resolvedCount: number;
  subscribed: number;
  subscribedPct: number;
  unsubscribed: number;
  unsubscribedPct: number;
  dialogued: number;
  dialoguedPct: number;
  activated: number;
  activatedPct: number;
  blocked: number;
  blockedPct: number;
  purchased: number;
  purchasedPct: number;
}

export interface AbTestStats {
  groupId: string;
  endedAt: string | null;
  variants: AbTestVariantStat[];
}

export const AB_TEST_METRIC_ROWS: { key: 'subscribed' | 'unsubscribed' | 'dialogued' | 'activated' | 'blocked' | 'purchased'; label: string }[] = [
  { key: 'subscribed', label: 'Подписаны' },
  { key: 'unsubscribed', label: 'Отписались' },
  { key: 'dialogued', label: 'Начали диалог' },
  { key: 'activated', label: 'Активировали бота' },
  { key: 'blocked', label: 'Заблокировали бота' },
  { key: 'purchased', label: 'Сделали ФД' },
];

// Список групп для страницы истории (запрос пользователя 2026-07-25: "завершенные тесты не
// показывай так, на отдельной странице лучше" — тот же принцип, что уже есть у истории A/B
// лендингов, /landings/history). triggerType/command — от основного сценария группы, только
// для заголовка карточки.
export interface ScenarioAbTestGroupListItem {
  id: string;
  createdAt: string;
  endedAt: string | null;
  resultsSnapshot: AbTestVariantStat[] | null;
  primaryScenarioId: string | null;
  triggerType: ScenarioTriggerType | null;
  command: string | null;
}

export function scenarioTitle(scenario: { triggerType: ScenarioTriggerType; command: string | null }): string {
  if (scenario.triggerType === 'COMMAND') return `/${scenario.command}`;
  return SINGLETON_TRIGGERS.find((t) => t.value === scenario.triggerType)?.title || TRIGGER_TYPE_LABEL[scenario.triggerType];
}

// "Тип содержимого" элемента — на бэкенде отдельно не хранится (незачем: полностью выводится
// из messageMedia/messageText), но нужен фронтенду и для выбора нужного мини-редактора, и для
// подписи элемента (запрос пользователя 2026-07-25, "подпиши чтобы было понятно сразу что
// это"). ALBUM — 2+ элементов в messageMedia (фото/видео вперемешку, ровно как ограничивает
// Bot API sendMediaGroup — без video_note/voice в альбоме).
export const CONTENT_TYPES = ['TEXT', 'PHOTO', 'VIDEO', 'ALBUM', 'VIDEO_NOTE', 'VOICE'] as const;
export type ElementContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_META: Record<ElementContentType, { label: string; icon: LucideIcon }> = {
  TEXT: { label: 'Текст', icon: MessageSquare },
  PHOTO: { label: 'Фотография', icon: Image },
  VIDEO: { label: 'Видео', icon: Video },
  ALBUM: { label: 'Альбом', icon: Images },
  VIDEO_NOTE: { label: 'Кружок', icon: Circle },
  VOICE: { label: 'Голосовое', icon: Mic },
};

export function deriveContentType(el: Pick<ScenarioElement, 'messageMedia'>): ElementContentType {
  const media = el.messageMedia || [];
  if (media.length === 0) return 'TEXT';
  if (media.length > 1) return 'ALBUM';
  const t = media[0].type;
  if (t === 'video_note') return 'VIDEO_NOTE';
  if (t === 'voice') return 'VOICE';
  if (t === 'video') return 'VIDEO';
  return 'PHOTO';
}

// Подпись элемента для карточки в редакторе — тип + "+ кнопка", если есть кнопки (запрос
// пользователя: "кружок + кнопка, кружок, фотография, альбом, видео, текст, аудио").
export function elementLabel(el: ScenarioElement, contentType?: ElementContentType): string {
  const type = contentType ?? deriveContentType(el);
  const base = CONTENT_TYPE_META[type].label;
  const hasButtons = !!el.buttons?.length;
  return hasButtons ? `${base} + кнопка` : base;
}
