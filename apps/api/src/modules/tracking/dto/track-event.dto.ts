import { IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsString, IsUrl } from 'class-validator';

// Зеркалит значения enum TrackingEvent из packages/types (PageView/Lead/Subscribe/
// Purchase/InitiateCheckout) + Click — отдельный пакет не подключаем ради одного
// списка строк, чтобы не тащить в это шаг сборку @trafficcrm/types.
const KNOWN_EVENT_NAMES = ['PageView', 'Lead', 'Subscribe', 'Purchase', 'InitiateCheckout', 'Click'];

export class TrackEventDto {
  @IsIn(KNOWN_EVENT_NAMES)
  eventName: string;

  @IsOptional()
  @IsString()
  fbclid?: string;

  @IsOptional()
  @IsString()
  ttclid?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  tgUserId?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  pageUrl?: string;

  @IsOptional()
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  utmSource?: string;

  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @IsOptional()
  @IsDateString()
  timestamp?: string;
}
