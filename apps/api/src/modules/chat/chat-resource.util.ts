import { ConversationSource } from '@prisma/client';

// Ключ ресурса диалога — тот же формат, что в ChatResourceAccess/ChatAutoAssignRule:
// 'BOT' — основной бот, 'BOT:<id>' — дополнительный, 'PERSONAL' — личка.
export function chatResourceKey(c: { source: ConversationSource; botKey: string }): string {
  if (c.source === 'PERSONAL') return 'PERSONAL';
  return c.botKey ? `BOT:${c.botKey}` : 'BOT';
}

// Ресурс из запроса: основной бот, дополнительный бот или личка (2026-10-25: настройки чата у каждого
// ресурса свои). Всё непонятное — основной бот.
export function normalizeChatResource(raw?: string | null): string {
  if (raw === 'PERSONAL' || raw === 'BOT') return raw;
  if (raw && /^BOT:[a-z0-9]{10,40}$/.test(raw)) return raw;
  return 'BOT';
}

// Вид ресурса — для общих папок шаблонов компании: любой бот или любая личка.
export function chatResourceKind(resource: string): 'BOT' | 'PERSONAL' {
  return resource === 'PERSONAL' ? 'PERSONAL' : 'BOT';
}
