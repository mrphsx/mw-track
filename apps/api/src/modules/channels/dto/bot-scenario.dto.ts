import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { BotScenarioTrigger } from '@prisma/client';
import { WelcomeButtonDto } from './create-channel.dto';

// Зарезервированные имена команд — уже жёстко обрабатываются grammy bot.command() в
// TelegramProvider.initialize() (см. handleStart/handlePurchaseCommand) и перехватывают
// апдейт раньше catch-all message:text-хендлера, где резолвятся пользовательские команды.
// Сценарий с таким command никогда бы не сработал — отклоняем на входе, а не создаём
// молча нерабочую запись.
const RESERVED_COMMANDS = ['start', 'purchase'];

export class CreateBotScenarioDto {
  @IsEnum(BotScenarioTrigger)
  triggerType: BotScenarioTrigger;

  // Обязателен и непуст только для triggerType=COMMAND — проверяется в сервисе (class-validator
  // не умеет "обязательно, если другое поле равно X" без ValidateIf на каждый конкретный кейс,
  // а здесь кейсов больше одного взаимоисключающего — понятнее и без сюрпризов проверить в коде).
  @IsOptional()
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Команда — латиница/цифры/подчёркивание, без слэша и пробелов' })
  command?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  delaySeconds?: number;

  @IsOptional()
  @IsString()
  messageText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => WelcomeButtonDto)
  buttons?: WelcomeButtonDto[];
}

export class UpdateBotScenarioDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  delaySeconds?: number;

  @IsOptional()
  @IsString()
  messageText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => WelcomeButtonDto)
  buttons?: WelcomeButtonDto[];
}

export class UploadScenarioMediaDto {
  @IsIn(['PHOTO', 'VIDEO', 'VIDEO_NOTE', 'VOICE', 'DOCUMENT'])
  mediaType: string;
}

export function assertValidCommand(triggerType: BotScenarioTrigger, command: string | undefined): string {
  if (triggerType !== 'COMMAND') return '';
  const normalized = (command || '').toLowerCase();
  if (!normalized) throw new BadRequestException('Для команды нужно указать её имя');
  if (RESERVED_COMMANDS.includes(normalized)) {
    throw new BadRequestException(`"${normalized}" — зарезервированная команда бота, выберите другое имя`);
  }
  return normalized;
}
