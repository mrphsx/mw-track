import { IsArray, IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { ChannelType } from '@prisma/client';

// Используется countPushAudience()/getClientsForPushInChunks() уже сейчас (шаг 1.6) —
// сама отправка пушей (Pushes-модуль) появится в шаге 1.8, но фильтр аудитории общий.
export class PushFilterDto {
  @IsOptional()
  @IsArray()
  @IsEnum(ChannelType, { each: true })
  channelTypes?: ChannelType[];

  @IsOptional()
  @IsBoolean()
  hasPurchase?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  countries?: string[];

  @IsOptional()
  @IsNumber()
  minSpent?: number;

  @IsOptional()
  @IsDateString()
  subscribedFrom?: string;

  @IsOptional()
  @IsDateString()
  subscribedTo?: string;

  @IsOptional()
  @IsNumber()
  inactiveDaysMin?: number;
}
