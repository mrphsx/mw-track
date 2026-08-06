import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ChannelType } from '@prisma/client';

// Express/qs парсит ?country=US в строку, а ?country=US&country=UK — в массив.
// Без этой нормализации однозначный фильтр (самый частый случай в UI) валился бы
// с "country must be an array".
const toArray = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null) return value;
  return Array.isArray(value) ? value : [value];
};

// Баг найден и исправлен 2026-07-21 (запрос пользователя: "фильтр не работает по диалогам,
// показывает тех же пользователей"): @Type(() => Boolean) вызывает нативный JS Boolean(value),
// а Boolean("false") === true — ЛЮБАЯ непустая строка из query (?hasDialogue=false) даёт true.
// Ломало все 4 boolean-фильтра ниже одинаково (hasPurchase/hasDialogue/isBotActive/
// isSubscribed), не только новый — проверено на реальных данных: ?hasPurchase=false отдавал
// тех же клиентов, что и ?hasPurchase=true.
const toBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
};

export class ClientFiltersDto {
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(ChannelType, { each: true })
  channelType?: ChannelType[];

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasPurchase?: boolean;

  // Есть ли диалог с клиентом (Client.firstDialogueAt задан) — запрос пользователя
  // 2026-07-21, тот же признак, что уже показывается колонкой "Диалог" в списке.
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasDialogue?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isBotActive?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isSubscribed?: boolean;

  // "ours" (по умолчанию) — только реальные клиенты воронки (subscribedAt задан). "external" —
  // холодные контакты, которые просто написали в личку/боту мимо нашей ссылки/лендинга
  // (subscribedAt: null, см. ClientsService.recordInboundMessage) — Client всё равно нужен,
  // чтобы вести с ними диалог, но не показывать вперемешку с "нашими" по умолчанию (баг-репорт
  // пользователя 2026-07-17). "all" — без этого фильтра вообще.
  @IsOptional()
  @IsIn(['ours', 'external', 'all'])
  origin?: 'ours' | 'external' | 'all';

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  country?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minSpent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxSpent?: number;

  @IsOptional()
  @IsDateString()
  subscribedFrom?: string;

  @IsOptional()
  @IsDateString()
  subscribedTo?: string;

  @IsOptional()
  @IsString()
  utmSource?: string;

  @IsOptional()
  @IsString()
  utmMedium?: string;

  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @IsOptional()
  @IsString()
  utmContent?: string;

  // Точная пер-лендинговая атрибуция — заполнен только для клиентов, пришедших через
  // PRIVATE_CHANNEL_REQUEST с известной invite-ссылкой лендинга (см. Client.landingId).
  @IsOptional()
  @IsString()
  landingId?: string;

  // Фильтры по рекламным данным (запрос пользователя 2026-07-24) — те же поля, что теперь
  // показываются в карточке клиента (ClientsService.getClientDetail). buyerId === 'none' —
  // отдельный смысл, "без баера" (та же метка, что уже показывает /team, только как фильтр).
  // Мульти-выбор (запрос пользователя 2026-08-03: "нету мультивыбора в фильтрах") — тот же
  // toArray-приём, что уже применён к channelType/country выше.
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  buyerId?: string[];

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  pixelId?: string[];

  @IsOptional()
  @IsString()
  campaignName?: string;

  @IsOptional()
  @IsString()
  adName?: string;

  @IsOptional()
  @IsString()
  adsetName?: string;

  @IsOptional()
  @IsString()
  siteSourceName?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['createdAt', 'totalSpent', 'lastActive', 'purchases'])
  sortBy?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  limit?: number;
}
