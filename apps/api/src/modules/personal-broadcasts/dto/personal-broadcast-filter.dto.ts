import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

// Тот же transform-паттерн, что уже в client-filters.dto.ts — @Type(()=>Boolean) неверно
// трактует строку "false" как true (баг, найденный и пофикшенный раньше в этой же сессии),
// поэтому здесь сразу правильный вариант, а не повторение того же класса бага.
const toBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
};

const toArray = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null) return value;
  return Array.isArray(value) ? value : [value];
};

// Фильтр аудитории для рассылки с личного аккаунта (запрос пользователя 2026-08-06) —
// заметно богаче PushFilterDto: депозиты (наличие/количество/сумма/давность), диалог
// (давность), подписки, страна, неактивность, папка Telegram. Базовое условие
// "dialogueSource=PERSONAL_ACCOUNT" не входит в DTO — оно всегда безусловно добавляется в
// PersonalBroadcastsService.buildAudienceWhere, эта фича принципиально только про диалоги с
// личным аккаунтом, не выбор пользователя.
export class PersonalBroadcastFilterDto {
  @IsOptional() @IsDateString() dialogueSince?: string;
  @IsOptional() @IsDateString() dialogueUntil?: string;

  @IsOptional() @Transform(toBoolean) @IsBoolean() hasPurchase?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() minPurchasesCount?: number;
  @IsOptional() @Type(() => Number) @IsInt() maxPurchasesCount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() minSpent?: number;
  @IsOptional() @Type(() => Number) @IsNumber() maxSpent?: number;
  // "По давности депозита" (запрос пользователя) — Client.lastPurchaseAt, новое денормализованное поле.
  @IsOptional() @IsDateString() lastPurchaseSince?: string;
  @IsOptional() @IsDateString() lastPurchaseUntil?: string;

  @IsOptional() @Transform(toBoolean) @IsBoolean() isSubscribed?: boolean;
  @IsOptional() @IsDateString() subscribedSince?: string;
  @IsOptional() @IsDateString() subscribedUntil?: string;
  @IsOptional() @IsDateString() unsubscribedSince?: string;
  @IsOptional() @IsDateString() unsubscribedUntil?: string;

  @IsOptional() @Transform(toArray) @IsArray() @IsString({ each: true }) country?: string[];

  @IsOptional() @Type(() => Number) @IsInt() inactiveDaysMin?: number;

  // Папка Telegram (запрос пользователя: "даже похорошему по папкам которые уже созданы в
  // телеграме") — id из GET /personal-broadcasts/folders, резолвится в tgUserId[] на бэкенде
  // через TelegramPersonalService.getFolderTgUserIds ДО построения where.
  @IsOptional() @Type(() => Number) @IsInt() folderId?: number;
}
