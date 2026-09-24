// Типы служебных оповещений компании (запрос пользователя 2026-09-16). Каждый тип соответствует
// реальному сигналу, который система уже знает о себе, — не придуманной метрике. Первые три
// вида раньше жили только в колокольчике Studio (dashboard/studio/layout.tsx), где считались на
// клиенте при открытии страницы; здесь то же самое считается на сервере и доставляется в Telegram.
export const NOTIFICATION_TYPES = [
  'LOW_BALANCE',
  'TRIAL_EXPIRING',
  'PLAN_DOWNGRADED',
  'CHANNEL_DISCONNECTED',
  'WEBHOOK_STALE',
  'PERSONAL_ACCOUNT_DISCONNECTED',
  'PIXEL_DELIVERY_FAILING',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_META: Record<NotificationType, { label: string; description: string }> = {
  LOW_BALANCE: {
    label: 'Низкий баланс',
    description: 'Баланса не хватит на продление тарифа в ближайшие 7 дней — иначе компанию переведёт на TRIAL.',
  },
  TRIAL_EXPIRING: {
    label: 'Заканчивается пробный период',
    description: 'До конца пробного периода осталось 3 дня или меньше.',
  },
  PLAN_DOWNGRADED: {
    label: 'Тариф понижен',
    description: 'Автопродление не прошло, компания переведена на TRIAL с его лимитами.',
  },
  CHANNEL_DISCONNECTED: {
    label: 'Отключён бот или канал',
    description: 'Бот проекта заблокирован, токен недействителен или сайт перестал проходить проверку.',
  },
  WEBHOOK_STALE: {
    label: 'Бот не получает обновления',
    description: 'Telegram больше 12 часов не присылает боту проекта ни одного обновления.',
  },
  PERSONAL_ACCOUNT_DISCONNECTED: {
    label: 'Отключён личный аккаунт',
    description: 'Telegram отозвал сессию личного аккаунта проекта — нужно переподключить.',
  },
  // 2026-09-17: на боевых данных нашлись пиксели, которые неделями отклоняли каждое событие
  // (перепутанная платформа, битый токен, пробел в ID), и в интерфейсе это никак не было видно.
  PIXEL_DELIVERY_FAILING: {
    label: 'Пиксель не принимает события',
    description: 'Facebook или TikTok отклоняет подряд все последние события пикселя — неверный токен, ID или платформа.',
  },
};

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

// Юзернейм Telegram: 5-32 символа, латиница/цифры/подчёркивание. Храним без @ и в нижнем регистре,
// потому что Telegram сравнивает юзернеймы без учёта регистра.
export function normalizeTelegramUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '').replace(/^https?:\/\/t\.me\//i, '').toLowerCase();
}

export const TELEGRAM_USERNAME_PATTERN = /^[a-z0-9_]{5,32}$/;

// Числовой id бота — часть токена до двоеточия ("123456789:AAF..."). Не меняется при перевыпуске
// токена в @BotFather, поэтому сравнивать ботов между собой нужно по нему, а не по токену целиком.
export function extractBotIdFromToken(token: string): string | null {
  const match = /^(\d{5,15}):[A-Za-z0-9_-]{30,}$/.exec(token.trim());
  return match ? match[1] : null;
}

// Минимальное экранирование для parse_mode=HTML — названия проектов пишут пользователи, а
// Telegram отвергает сообщение целиком при незакрытом "<".
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
