// Персонализация текста сообщений в рассылках и сценариях бота (запрос пользователя
// 2026-07-27: "{first_name} и другие, которые потом заменяются данными человека, которому
// бот отправляет сообщение"). Один общий хелпер для обоих потребителей —
// ChannelsService.sendMessage (рассылки/PushesProcessor, автоворонки) и
// BotScenarioEngineService.sendStepMessage (сценарии) — вместо двух похожих реализаций,
// подстановка синтаксически идентична в обоих местах, разница только в том, откуда берётся
// сам Client.
export interface MessagePlaceholderSource {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}

export interface MessagePlaceholderInfo {
  key: string;
  label: string;
  description: string;
}

// Продублировано в apps/web/src/lib/message-placeholders.ts (нет общего пакета между apps/web
// и apps/api в этом монорепо) — только для показа списка в UI, сама подстановка происходит
// исключительно на бэкенде.
export const MESSAGE_PLACEHOLDERS: MessagePlaceholderInfo[] = [
  { key: 'first_name', label: 'Имя', description: 'Имя клиента из Telegram-профиля' },
  { key: 'last_name', label: 'Фамилия', description: 'Фамилия клиента из Telegram-профиля (если указана)' },
  { key: 'full_name', label: 'Имя и фамилия', description: 'Имя + фамилия через пробел (без фамилии — просто имя)' },
  { key: 'username', label: 'Username', description: 'Username клиента в Telegram, без @ (если не указан — пусто)' },
];

// Если source не передан (холодный контакт без строки Client) или поле не заполнено —
// плейсхолдер заменяется на пустую строку, а не оставляется как есть: незаполненный текст
// вида "Привет, !" считается меньшим злом, чем видимый клиенту "Привет, {first_name}!".
export function renderMessagePlaceholders(text: string, source?: MessagePlaceholderSource | null): string {
  const firstName = source?.firstName?.trim() || '';
  const lastName = source?.lastName?.trim() || '';
  const values: Record<string, string> = {
    first_name: firstName,
    last_name: lastName,
    full_name: [firstName, lastName].filter(Boolean).join(' '),
    username: source?.username?.trim() || '',
  };

  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key] : match));
}
