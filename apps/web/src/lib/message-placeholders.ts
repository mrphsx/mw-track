// Список плейсхолдеров персонализации для текста рассылок/сценариев (запрос пользователя
// 2026-07-27) — подстановка происходит на бэкенде (см.
// apps/api/src/common/message-placeholders.util.ts), здесь только список для UI-подсказки.
// Продублировано — нет общего пакета между apps/web и apps/api в этом монорепо.
export interface MessagePlaceholderInfo {
  key: string;
  description: string;
}

export const MESSAGE_PLACEHOLDERS: MessagePlaceholderInfo[] = [
  { key: 'first_name', description: 'Имя клиента из Telegram-профиля' },
  { key: 'last_name', description: 'Фамилия клиента (если указана)' },
  { key: 'full_name', description: 'Имя + фамилия через пробел' },
  { key: 'username', description: 'Username в Telegram, без @ (если не указан — пусто)' },
];
