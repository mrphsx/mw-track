import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

// Единый API событий (2026-11-05): внешние сервисы (боты на других платформах, свои воронки)
// присылают лидов и их события. Поля — snake_case, как принято в публичных API.
export const EXT_EVENT_TYPES = [
  'start',
  'lead',
  'subscribe',
  'unsubscribe',
  'message_in',
  'message_out',
  'bot_blocked',
  'bot_unblocked',
  'contact',
  'purchase',
] as const;
export type ExtEventType = (typeof EXT_EVENT_TYPES)[number];

const toStr = ({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : value);

export class ExtAttributionDto {
  @IsOptional() @IsString() @MaxLength(500) fbclid?: string;
  @IsOptional() @IsString() @MaxLength(500) ttclid?: string;
  @IsOptional() @IsString() @MaxLength(200) fbp?: string;
  @IsOptional() @IsString() @MaxLength(200) utm_source?: string;
  @IsOptional() @IsString() @MaxLength(200) utm_medium?: string;
  @IsOptional() @IsString() @MaxLength(300) utm_campaign?: string;
  @IsOptional() @IsString() @MaxLength(300) utm_content?: string;
  @IsOptional() @IsString() @MaxLength(300) utm_term?: string;
  @IsOptional() @IsString() @MaxLength(100) campaign_id?: string;
  @IsOptional() @IsString() @MaxLength(300) campaign_name?: string;
  @IsOptional() @IsString() @MaxLength(100) adset_id?: string;
  @IsOptional() @IsString() @MaxLength(300) adset_name?: string;
  @IsOptional() @IsString() @MaxLength(100) ad_id?: string;
  @IsOptional() @IsString() @MaxLength(300) ad_name?: string;
  @IsOptional() @IsString() @MaxLength(100) placement?: string;
  @IsOptional() @IsString() @MaxLength(100) site_source_name?: string;
  // ID пикселя или его короткий код из ссылки (pixel=), ID или код баера (z=).
  @IsOptional() @IsString() @MaxLength(64) pixel?: string;
  @IsOptional() @IsString() @MaxLength(64) buyer?: string;
  @IsOptional() @IsString() @MaxLength(64) ip?: string;
  @IsOptional() @IsString() @MaxLength(500) user_agent?: string;
  @IsOptional() @IsString() @MaxLength(2) country_code?: string;
}

export class ExtEventDto {
  @IsIn(EXT_EVENT_TYPES as unknown as string[])
  type!: ExtEventType;

  // Ключ идемпотентности: повтор события с тем же event_id не обрабатывается второй раз.
  @IsOptional() @IsString() @MaxLength(200) event_id?: string;
  @IsOptional() @IsString() @MaxLength(40) occurred_at?: string;

  // Кто: Telegram ID, или ID в вашей системе, или телефон / email.
  @IsOptional() @Transform(toStr) @IsString() @MaxLength(32) tg_user_id?: string;
  @IsOptional() @Transform(toStr) @IsString() @MaxLength(200) external_id?: string;
  @IsOptional() @IsString() @MaxLength(64) username?: string;
  @IsOptional() @IsString() @MaxLength(128) first_name?: string;
  @IsOptional() @IsString() @MaxLength(128) last_name?: string;
  @IsOptional() @IsString() @MaxLength(10) language?: string;
  @IsOptional() @Transform(toStr) @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;

  // Код визита из /start (параметр ссылки t.me/бот?start=КОД) — по нему вся атрибуция лендинга.
  @IsOptional() @IsString() @MaxLength(200) start_code?: string;
  // Или атрибуция напрямую — если лид пришёл не через наш лендинг.
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ExtAttributionDto) attribution?: ExtAttributionDto;

  @IsOptional() @IsString() @MaxLength(4096) text?: string;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) amount?: number;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @Transform(toStr) @IsString() @MaxLength(200) purchase_id?: string;
}

export class ExtEventsBatchDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ExtEventDto)
  events!: ExtEventDto[];
}
