import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PersonalBroadcastFilterDto } from './personal-broadcast-filter.dto';

class PersonalBroadcastButtonDto {
  @IsString()
  text: string;

  @IsOptional()
  @IsString()
  url?: string;
}

// Один вариант контента (запрос пользователя: "можно загрузить например 2 варианта, и половине
// аудитории отправится один вариант а второй половине второй") — одно медиа на вариант, не
// альбом: содержимое этой фичи — варианты текста/картинки для анти-спам-разнообразия, не
// множественные вложения в одном сообщении (в отличие от Push.messageMedia).
class PersonalBroadcastVariantDto {
  @IsString()
  messageText: string;

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonalBroadcastButtonDto)
  buttons?: PersonalBroadcastButtonDto[];
}

export class CreatePersonalBroadcastDto {
  @IsString()
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PersonalBroadcastVariantDto)
  variants: PersonalBroadcastVariantDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => PersonalBroadcastFilterDto)
  filter: PersonalBroadcastFilterDto;

  // Случайный разброс, не фиксированное число (запрос пользователя: "телеграм может
  // заблокировать за спам" — константный интервал сам по себе паттерн, легко детектируемый).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  delayMinSeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  delayMaxSeconds?: number;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsBoolean()
  sendNow?: boolean;
}
