import { BadRequestException } from '@nestjs/common';

// Воронка проекта (запрос пользователя 2026-10-24, вкладка «Воронка»): что считается лидом
// (Client.subscribedAt + событие Subscribe) и что — диалогом (firstDialogueAt + событие
// Dialogue). Раньше это неявно выводилось из Channel.tgMode в нескольких местах кода; теперь все
// они спрашивают resolveFunnelConfig.
//
// Project.funnelConfig = null (все проекты на момент появления настройки) — legacyFunnelConfig
// воспроизводит прежние условия буквально, поэтому без явного сохранения воронки ни одна цифра
// не меняется. Заявка в приватный канал по нашей ссылке (TelegramProvider.handleJoinRequest)
// остаётся лидом всегда и здесь не настраивается — это основа режима «Приватный канал».
// Ручная фиксация диалога (менеджер через бота, кнопка в CRM) тоже работает всегда.

// Start в боте:
// - ALL — любой, кто впервые нажал Start (бывший Channel.tgDirectTraffic);
// - TRACKED — пришедшие с лендинга (start-код) или по ссылке на бота;
// - LINKS — только по ссылке на бота (поведение режима «Сразу в бота» без прямого трафика);
// - OFF — Start лидом не делает.
export const LEAD_BOT_START = ['ALL', 'TRACKED', 'LINKS', 'OFF'] as const;
export type LeadBotStart = (typeof LEAD_BOT_START)[number];

// Вступление в канал мимо заявки по нашей ссылке (chat_member): ANY — лид, OFF — внешняя
// подписка (externalSubscribedAt), в статистику не идёт.
export const LEAD_CHANNEL_JOIN = ['ANY', 'OFF'] as const;
export type LeadChannelJoin = (typeof LEAD_CHANNEL_JOIN)[number];

export interface FunnelConfig {
  leadBotStart: LeadBotStart;
  leadChannelJoin: LeadChannelJoin;
  // Первое сообщение в подключённую личку делает человека лидом.
  leadPersonalMessage: boolean;
  // Сообщение боту (включая Start) — диалог.
  dialogueBotMessage: boolean;
  // Сообщение в подключённую личку — диалог.
  dialoguePersonalMessage: boolean;
}

export interface FunnelChannel {
  type: string;
  tgMode: string | null;
  tgDirectTraffic: boolean;
  // Только для подписи стадии — вступление в канал возможно, лишь если канал указан.
  tgChannelId?: string | null;
}

// Прежние условия из кода — по одному на поле:
// - leadBotStart: handleStart считал лидом только при tgMode === 'BOT_DIRECT' — по ссылке на бота
//   всегда, любого — при tgDirectTraffic;
// - leadChannelJoin: handleChatMemberUpdate делал внешнюю подписку только для PRIVATE_CHANNEL_REQUEST;
// - leadPersonalMessage: личка лидом не делала никогда (treatAsSubscriber: false);
// - dialogueBotMessage: countBotAsDialogue = tgMode === 'BOT_DIRECT';
// - dialoguePersonalMessage: сообщение в личку было диалогом всегда.
export function legacyFunnelConfig(channel: FunnelChannel | null): FunnelConfig {
  // Строго tgMode, без подстановки BOT_DIRECT для null: старые условия сравнивали именно его.
  const mode = channel?.type === 'TELEGRAM' ? channel.tgMode : null;
  return {
    leadBotStart: mode === 'BOT_DIRECT' ? (channel?.tgDirectTraffic ? 'ALL' : 'LINKS') : 'OFF',
    leadChannelJoin: mode === 'PRIVATE_CHANNEL_REQUEST' ? 'OFF' : 'ANY',
    leadPersonalMessage: false,
    dialogueBotMessage: mode === 'BOT_DIRECT',
    dialoguePersonalMessage: true,
  };
}

// Сохранённая настройка поверх прежней логики: незаполненное или некорректное поле берётся из
// legacyFunnelConfig, так что частично сохранённый или испорченный JSON не может «выключить»
// учёт молча.
export function resolveFunnelConfig(stored: unknown, channel: FunnelChannel | null): FunnelConfig {
  const legacy = legacyFunnelConfig(channel);
  if (!stored || typeof stored !== 'object') return legacy;
  const s = stored as Record<string, unknown>;
  return {
    leadBotStart: LEAD_BOT_START.includes(s.leadBotStart as LeadBotStart) ? (s.leadBotStart as LeadBotStart) : legacy.leadBotStart,
    leadChannelJoin: LEAD_CHANNEL_JOIN.includes(s.leadChannelJoin as LeadChannelJoin) ? (s.leadChannelJoin as LeadChannelJoin) : legacy.leadChannelJoin,
    leadPersonalMessage: typeof s.leadPersonalMessage === 'boolean' ? s.leadPersonalMessage : legacy.leadPersonalMessage,
    dialogueBotMessage: typeof s.dialogueBotMessage === 'boolean' ? s.dialogueBotMessage : legacy.dialogueBotMessage,
    dialoguePersonalMessage: typeof s.dialoguePersonalMessage === 'boolean' ? s.dialoguePersonalMessage : legacy.dialoguePersonalMessage,
  };
}

// Строгая проверка того, что сохраняет пользователь (в отличие от resolveFunnelConfig, который
// терпим к старому/битому JSON при чтении).
export function parseFunnelConfigInput(input: unknown): FunnelConfig {
  if (!input || typeof input !== 'object') throw new BadRequestException('Некорректная настройка воронки');
  const s = input as Record<string, unknown>;
  if (!LEAD_BOT_START.includes(s.leadBotStart as LeadBotStart)) throw new BadRequestException('Некорректное значение «Start в боте»');
  if (!LEAD_CHANNEL_JOIN.includes(s.leadChannelJoin as LeadChannelJoin)) throw new BadRequestException('Некорректное значение «Вступление в канал»');
  for (const key of ['leadPersonalMessage', 'dialogueBotMessage', 'dialoguePersonalMessage'] as const) {
    if (typeof s[key] !== 'boolean') throw new BadRequestException(`Некорректное значение ${key}`);
  }
  return {
    leadBotStart: s.leadBotStart as LeadBotStart,
    leadChannelJoin: s.leadChannelJoin as LeadChannelJoin,
    leadPersonalMessage: s.leadPersonalMessage as boolean,
    dialogueBotMessage: s.dialogueBotMessage as boolean,
    dialoguePersonalMessage: s.dialoguePersonalMessage as boolean,
  };
}

// Подпись стадии «лид» в воронке статистики — по тому, что реально делает лидом. До настройки
// стадия всегда называлась «Вступили в канал», даже у проектов, где лид — Start в боте.
export function leadStageLabel(config: FunnelConfig, channel: FunnelChannel | null): string {
  if (channel?.type === 'WEBSITE') return 'Стали клиентом';
  const joinsChannel = channel?.tgMode === 'PRIVATE_CHANNEL_REQUEST' || (config.leadChannelJoin === 'ANY' && !!channel?.tgChannelId);
  const sources = [joinsChannel, config.leadBotStart !== 'OFF', config.leadPersonalMessage].filter(Boolean).length;
  if (sources > 1) return 'Стали лидом';
  if (config.leadBotStart !== 'OFF') return 'Запустили бота';
  if (config.leadPersonalMessage) return 'Написали в личку';
  return 'Вступили в канал';
}
