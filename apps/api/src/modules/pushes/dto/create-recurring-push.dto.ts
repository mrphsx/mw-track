import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { OmitType } from '@nestjs/swagger';
import { CreatePushDto } from './create-push.dto';

export class RecurrenceDayDto {
  @IsInt()
  @Min(1)
  @Max(7)
  day!: number;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  time!: string;
}

// Регулярная рассылка (2026-11-05): контент и фильтр — как у обычной, плюс проекты и расписание.
export class CreateRecurringPushDto extends OmitType(CreatePushDto, ['scheduledAt'] as const) {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  projectIds!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => RecurrenceDayDto)
  days!: RecurrenceDayDto[];

  @IsString()
  @MaxLength(64)
  timezone!: string;
}

export class UpdateRecurringPushDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => RecurrenceDayDto)
  days?: RecurrenceDayDto[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  // Новый список проектов серии (например, убрать один проект).
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  projectIds?: string[];
}
