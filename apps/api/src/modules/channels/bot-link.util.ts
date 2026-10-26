import { randomInt } from 'crypto';
import { BotLinkSource } from '@prisma/client';

// Ссылки на бота для трафика без лендинга (запрос пользователя 2026-10-23), см. BotLink в
// schema.prisma. Формат start-параметра: go_<code>[_<adId>[_<campaignId>]] — Telegram пропускает
// в start только [A-Za-z0-9_-] и не длиннее 64 символов: 3 + 8 + 2 × (1 + 24) = 61.
const START_PREFIX = 'go_';
const CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const CODE_LENGTH = 8;
const START_RE = /^go_([a-z0-9]{8})(?:_([A-Za-z0-9-]{1,24}))?(?:_([A-Za-z0-9-]{1,24}))?$/;

export function generateBotLinkCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export interface ParsedBotLinkStart {
  code: string;
  adId?: string;
  campaignId?: string;
}

export function parseBotLinkStart(startParam: string | undefined): ParsedBotLinkStart | null {
  const match = startParam?.match(START_RE);
  if (!match) return null;
  return { code: match[1], adId: match[2], campaignId: match[3] };
}

// Макросы рекламных кабинетов для id объявления и кампании. Названия ({{ad.name}} и т.п.) не
// годятся: в них пробелы и кириллица, Telegram такой start просто отбросит вместе с кодом.
// Telegram Ads и прочие источники макросов не подставляют — ссылка у них статичная.
const SOURCE_MACROS: Partial<Record<BotLinkSource, { adId: string; campaignId: string }>> = {
  FACEBOOK: { adId: '{{ad.id}}', campaignId: '{{campaign.id}}' },
  TIKTOK: { adId: '__CID__', campaignId: '__CAMPAIGN_ID__' },
};

export function buildBotLinkUrl(botUsername: string, code: string, source: BotLinkSource): string {
  const macros = SOURCE_MACROS[source];
  const start = macros ? `${START_PREFIX}${code}_${macros.adId}_${macros.campaignId}` : `${START_PREFIX}${code}`;
  return `https://t.me/${botUsername}?start=${start}`;
}

// Пишется в Client.utmSource — так клиенты прямого трафика различаются по площадке в тех же
// разрезах статистики, что и клиенты с лендингов.
export const BOT_LINK_UTM_SOURCE: Record<BotLinkSource, string> = {
  FACEBOOK: 'facebook',
  TIKTOK: 'tiktok',
  TELEGRAM_ADS: 'telegram_ads',
  OTHER: 'bot_link',
};
