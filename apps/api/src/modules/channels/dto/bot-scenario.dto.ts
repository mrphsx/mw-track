import { BadRequestException } from '@nestjs/common';
import { IsBoolean, IsEnum, IsOptional, Matches } from 'class-validator';
import { BotScenarioTrigger } from '@prisma/client';

// Зарезервированные имена команд — уже жёстко обрабатываются grammy bot.command() в
// TelegramProvider.initialize() (см. handleStart/handlePurchaseCommand) и перехватывают
// апдейт раньше catch-all message:text-хендлера, где резолвятся пользовательские команды.
// Сценарий с таким command никогда бы не сработал — отклоняем на входе, а не создаём
// молча нерабочую запись.
const RESERVED_COMMANDS = ['start', 'purchase'];

// Поля одиночного сообщения (delaySeconds/messageText/mediaType/mediaKey/buttons) убраны
// отсюда 2026-07-22 — содержимое сценария теперь живёт в BotScenarioStep (см.
// bot-scenario-element.dto.ts), сам BotScenario создаётся пустым (только триггер), затем
// наполняется шагами на отдельной странице редактора — тот же паттерн, что уже был у
// AutomationFlow. Медиа для шагов грузится через отдельный ScenarioStepMediaController
// (не привязано к конкретному сценарию/шагу на момент загрузки).
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
}

export class UpdateBotScenarioDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export function assertValidCommand(triggerType: BotScenarioTrigger, command: string | undefined): string {
  if (triggerType !== 'COMMAND') return '';
  const normalized = (command || '').toLowerCase();
  if (!normalized) throw new BadRequestException('Для команды нужно указать её имя');
  if (RESERVED_COMMANDS.includes(normalized)) {
    throw new BadRequestException(`"${normalized}" — зарезервированная команда бота, выберите другое имя`);
  }
  // Служебный префикс для A/B-вариантов (см. BotScenariosService.addAbTestVariant) — не
  // реальная зарезервированная команда бота, но занятая нами схема именования, коллизия с
  // которой сломает фильтрацию "основной сценарий vs вариант" в списке.
  if (normalized.startsWith('__ab_')) {
    throw new BadRequestException('Команды с префиксом "__ab_" зарезервированы под A/B-тесты — выберите другое имя');
  }
  return normalized;
}
