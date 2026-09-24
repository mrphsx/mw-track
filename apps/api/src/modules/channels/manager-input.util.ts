// Разбор того, что менеджер присылает боту канала текстом (запрос пользователя 2026-09-17:
// "чтобы можно было отправить не только пересланное, но и юзер айди или тэг клиента"), и суммы
// покупки. Отдельно от TelegramProvider, чтобы правила можно было проверить без бота.

// Минимум полей MessageEntity из Bot API, которые здесь нужны.
export interface ManagerMessageEntity {
  type: string;
  offset: number;
  length: number;
  user?: { id: number };
  url?: string;
}

export type ClientIdentifier = { kind: 'id'; value: string } | { kind: 'username'; value: string };

// Правила username в Telegram: 5–32 символа, латиница/цифры/подчёркивание, начинается с буквы.
// Нижнюю границу берём 4 — у старых и коллекционных (Fragment) имён бывает короче 5.
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
// user_id — положительное целое; 5 цифр — чтобы не принять за ID случайное короткое число.
const USER_ID_RE = /^\d{5,15}$/;
// Служебные пути t.me, за которыми стоит не пользователь.
const RESERVED_TME_PATHS = new Set(['c', 's', 'joinchat', 'addstickers', 'addemoji', 'share', 'proxy', 'socks', 'iv', 'login', 'setlanguage', 'bg', 'addtheme', 'invoice', 'boost']);

export function parseClientIdentifier(rawText: string, entities: ManagerMessageEntity[] = []): ClientIdentifier | null {
  const text = rawText.trim();
  if (!text) return null;

  // Упоминание человека без username (выбрали его из списка при наборе) — Telegram сам
  // кладёт в сообщение его ID, это самый надёжный вариант.
  const textMention = entities.find((e) => e.type === 'text_mention' && e.user);
  if (textMention?.user) return { kind: 'id', value: String(textMention.user.id) };

  const tgUserLink = text.match(/tg:\/\/user\?id=(\d{5,15})/i);
  if (tgUserLink) return { kind: 'id', value: tgUserLink[1] };

  const tmeLink = text.match(/(?:https?:\/\/)?(?:t|telegram)\.me\/([A-Za-z0-9_]+)/i);
  if (tmeLink && !RESERVED_TME_PATHS.has(tmeLink[1].toLowerCase()) && USERNAME_RE.test(tmeLink[1])) {
    return { kind: 'username', value: tmeLink[1] };
  }

  const mention = entities.find((e) => e.type === 'mention');
  if (mention) {
    const value = text.slice(mention.offset + 1, mention.offset + mention.length);
    if (USERNAME_RE.test(value)) return { kind: 'username', value };
  }
  const atUsername = text.match(/(?:^|\s)@([A-Za-z][A-Za-z0-9_]{3,31})\b/);
  if (atUsername) return { kind: 'username', value: atUsername[1] };

  // "123456789", "id 123456789", "ID: 123456789", "user_id=123456789"
  const idCandidate = text.replace(/^(?:user[_\s]?id|id)\s*[:=#]?\s*/i, '');
  if (USER_ID_RE.test(idCandidate)) return { kind: 'id', value: idCandidate };

  // Имя без "@" — единственное слово, похожее на username и не похожее на число.
  if (USERNAME_RE.test(text)) return { kind: 'username', value: text };

  return null;
}

// Пока бот ждёт сумму, число из 7+ цифр — это ID клиента, а не сумма: депозитов на миллион
// долларов здесь не бывает, а менеджер мог просто перейти к следующему клиенту.
export function looksLikeUserIdInsteadOfAmount(rawText: string): boolean {
  return /^\d{7,15}$/.test(rawText.trim());
}

export const MAX_MANAGER_PURCHASE_USD = 100_000;

export type ParsedAmount = { amount: number } | { error: 'format' | 'too_small' | 'too_large' };

// "150", "49.99", "49,99", "$150", "150$", "150 usd", "1 250". Не больше двух знаков после
// разделителя: "1,250" неоднозначно (тысячи или 1.25), поэтому не принимается — бот попросит
// ввести сумму ещё раз, а не запишет неверную.
export function parseUsdAmount(rawText: string): ParsedAmount {
  const cleaned = rawText
    .trim()
    .toLowerCase()
    .replace(/usd|долл(ар(ов|а)?)?\.?|\$/g, '')
    .replace(/\s/g, '');
  if (!/^\d+([.,]\d{1,2})?$/.test(cleaned)) return { error: 'format' };
  const amount = Math.round(Number(cleaned.replace(',', '.')) * 100) / 100;
  if (!(amount >= 0.01)) return { error: 'too_small' };
  if (amount > MAX_MANAGER_PURCHASE_USD) return { error: 'too_large' };
  return { amount };
}

// Похоже ли сообщение на попытку ввести сумму: цифры с разделителями и, возможно, знаком
// доллара. Решает, куда направить сообщение, а проверяет саму сумму parseUsdAmount.
export function looksLikeAmountInput(rawText: string): boolean {
  return /^\$?\s*\d[\d\s.,]*\s*(\$|usd|долл\S*)?$/i.test(rawText.trim());
}
