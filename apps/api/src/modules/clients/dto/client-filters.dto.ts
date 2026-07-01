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

export class ClientFiltersDto {
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(ChannelType, { each: true })
  channelType?: ChannelType[];

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasPurchase?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isBotActive?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isSubscribed?: boolean;

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
  utmCampaign?: string;

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
