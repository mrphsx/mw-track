import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';
import { ChannelType, TelegramMode } from '@prisma/client';

export class CreateChannelDto {
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsEnum(ChannelType)
  type: ChannelType;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  tgBotToken?: string;

  @IsOptional()
  @IsString()
  tgChannelId?: string;

  @IsOptional()
  @IsString()
  tgChannelUsername?: string;

  // Задержка одобрения заявки, секунды — 0/не задано = без задержки. Верхняя граница 3600
  // (час) — эксплуатационная защита от опечатки, не техническое ограничение Telegram.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  tgJoinDelaySeconds?: number;

  // 4 способа, которыми лендинг ведёт в Telegram — см. prisma/schema.prisma enum TelegramMode.
  @IsOptional()
  @IsEnum(TelegramMode)
  tgMode?: TelegramMode;

  // Только для tgMode=PERSONAL_DM — личный @username, без бота вообще.
  @IsOptional()
  @IsString()
  tgPersonalUsername?: string;

  // Список @username менеджеров, которым доступна пересылка сообщений клиента боту для
  // ручной фиксации диалога (запрос пользователя 2026-07-21, см. комментарий в schema.prisma).
  // Нормализуем: без ведущего @, без пустых строк — сравнение в TelegramProvider тоже
  // регистронезависимое, но не хотим хранить исходный регистр вперемешку.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map((v: string) => v.trim().replace(/^@/, '')).filter(Boolean) : value,
  )
  tgManagerUsernames?: string[];

  @IsOptional()
  @IsString()
  wa360Token?: string;

  @IsOptional()
  @IsString()
  igPageId?: string;

  @IsOptional()
  @IsString()
  igAccessToken?: string;

  // Обычный сайт (ChannelType.WEBSITE, запрос пользователя 2026-09-03) — адрес, куда ведёт
  // кнопка лендинга и который WebsiteProvider.initialize() реально проверяет на наличие
  // track.js. require_tld:false — стейджинг/тест-домены без точки в конце тоже валидны,
  // реальная защита от произвольного адреса — SSRF-проверка внутри самой верификации, не DTO.
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  websiteUrl?: string;
}
