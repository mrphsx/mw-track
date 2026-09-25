import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CloakingActionType, CloakingConditionField, CloakingRuleMatchLogic } from '@prisma/client';

// config валидируется мягко (@IsObject(), без пер-полевой формы) — форму знает конкретный
// evaluator (apps/api/src/modules/landings/cloaking/conditions/), а не DTO-слой. Тот же уровень
// строгости, что уже принят для PersonalBroadcast.filter/Landing.tiktokHintTexts: неверно
// собранный config просто заставит своё условие тихо оценится в false, а не 500.
export class CloakingConditionDto {
  @IsEnum(CloakingConditionField)
  field: CloakingConditionField;

  @IsOptional()
  @IsBoolean()
  negate?: boolean;

  @IsObject()
  config: Record<string, unknown>;
}

export class CreateCloakingRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEnum(CloakingRuleMatchLogic)
  matchLogic?: CloakingRuleMatchLogic;

  @IsEnum(CloakingActionType)
  action: CloakingActionType;

  @IsOptional()
  @IsString()
  actionRedirectUrl?: string;

  @IsOptional()
  @IsString()
  actionCustomHtml?: string;

  @IsOptional()
  @IsString()
  actionCustomText?: string;

  // Разумный потолок — правило с сотнями условий почти наверняка ошибка ввода, не реальный
  // сценарий; не жёсткий бизнес-лимит, просто защита от случайного/вредоносного разрастания.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CloakingConditionDto)
  conditions?: CloakingConditionDto[];
}

export class UpdateCloakingRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsEnum(CloakingRuleMatchLogic)
  matchLogic?: CloakingRuleMatchLogic;

  @IsOptional()
  @IsEnum(CloakingActionType)
  action?: CloakingActionType;

  @IsOptional()
  @IsString()
  actionRedirectUrl?: string;

  @IsOptional()
  @IsString()
  actionCustomHtml?: string;

  @IsOptional()
  @IsString()
  actionCustomText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CloakingConditionDto)
  conditions?: CloakingConditionDto[];
}

export class ReorderCloakingRulesDto {
  @IsArray()
  @IsString({ each: true })
  ruleIds: string[];
}
