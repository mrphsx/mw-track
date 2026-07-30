import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { AutomationStepType } from '@prisma/client';

// Та же форма {text, url}, что и у Push.buttons/BotScenarioStep.buttons — сознательно
// дублируется в каждом модуле, а не выносится в общий пакет (см. CLAUDE.md про пиксели:
// каждая фича — свой модуль, минимум лишних межмодульных импортов ради одной формы).
export class AutomationButtonDto {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsUrl({ require_protocol: true })
  url: string;
}

// v1: единственное поддерживаемое условие — "совершил/не совершил покупку" (буквально из
// примера в 15_PHASES.md 3.1). Формат объекта заложен на вырост под остальные поля наподобие
// PushFilterDto (country/minSpent/inactiveDaysMin) — добавятся новыми опциональными полями
// без миграции (conditionFilter — Json).
export class AutomationConditionFilterDto {
  @IsOptional()
  @IsBoolean()
  hasPurchase?: boolean;
}

// 30 дней с запасом — достаточно для сценариев из спеки ("подождать 1 день"/"2 дня"), при
// этом не бесконечное значение на случай опечатки пользователя.
const MAX_DELAY_SECONDS = 30 * 24 * 60 * 60;

export class CreateAutomationStepDto {
  @IsIn(['DELAY', 'SEND_PUSH', 'CONDITION'])
  type: AutomationStepType;

  // Обязательность конкретных полей в зависимости от type проверяется в сервисе (как и в
  // bot-scenario.dto.ts — class-validator неудобен для "обязательно, если type=X" на 3+
  // взаимоисключающих случаях).
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DELAY_SECONDS)
  delaySeconds?: number;

  @IsOptional()
  @IsString()
  messageText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => AutomationButtonDto)
  buttons?: AutomationButtonDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AutomationConditionFilterDto)
  conditionFilter?: AutomationConditionFilterDto;
}

export class UpdateAutomationStepDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DELAY_SECONDS)
  delaySeconds?: number;

  @IsOptional()
  @IsString()
  messageText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => AutomationButtonDto)
  buttons?: AutomationButtonDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AutomationConditionFilterDto)
  conditionFilter?: AutomationConditionFilterDto;
}

export class MoveAutomationStepDto {
  @IsIn(['up', 'down'])
  direction: 'up' | 'down';
}
