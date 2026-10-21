import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { GAME_KINDS, GAME_LIMITS } from '../game.util';
import { LandingBehaviorDto } from './landing-behavior.dto';
import { BUILDER_TEMPLATE_ID } from '../builder.util';
import { PUCK_TEMPLATE_ID } from '../puck.util';

// Баг-репорт пользователя 2026-07-15: "при выборе telegram тёмный или светлый пишет ошибка
// валидации" — этот whitelist дублирует список из LandingsService.getTemplates(), но не
// обновлялся при добавлении новых шаблонов (telegram-light/dark 2026-07-04, tg-invite-dark/
// light 2026-07-14/15), из-за чего @IsIn молча резал ЛЮБОЙ templateId не из первых трёх.
// Держать в синхроне с LandingsService.getTemplates() при добавлении новых шаблонов.
const TEMPLATE_IDS = [
  'minimal', 'gradient', 'dark', 'telegram-light', 'telegram-dark', 'tg-invite-dark', 'tg-invite-light',
  'age-gate-invite', 'countdown-urgency',
  ...Object.keys(GAME_KINDS),
  BUILDER_TEMPLATE_ID,
  PUCK_TEMPLATE_ID,
];

// Игровые шаблоны (запрос пользователя 2026-10-18) — все поля необязательны, пустое = дефолт игры
// (см. resolveGameConfig в game.util.ts). Один DTO на все четыре игры: ключи чужой игры просто
// не используются при рендере.
export class GameQuizQuestionDto {
  @IsString() @MaxLength(GAME_LIMITS.text) question: string;

  @IsArray()
  @ArrayMinSize(GAME_LIMITS.minOptions)
  @ArrayMaxSize(GAME_LIMITS.maxOptions)
  @IsString({ each: true })
  @MaxLength(GAME_LIMITS.text, { each: true })
  options: string[];
}

export class GameConfigDto {
  @IsOptional() @IsString() @MaxLength(GAME_LIMITS.text) title?: string;
  @IsOptional() @IsString() @MaxLength(GAME_LIMITS.text) subtitle?: string;
  @IsOptional() @IsString() @MaxLength(GAME_LIMITS.text) prizeCaption?: string;
  @IsOptional() @IsString() @MaxLength(GAME_LIMITS.text) prizeNote?: string;
  @IsOptional() @IsString() @MaxLength(GAME_LIMITS.text) winButtonText?: string;
  @IsOptional() @IsString() @MaxLength(GAME_LIMITS.longText) finePrint?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Цвет — в формате #RRGGBB' }) accentColor?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(GAME_LIMITS.minSegments)
  @ArrayMaxSize(GAME_LIMITS.maxSegments)
  @IsString({ each: true })
  @MaxLength(GAME_LIMITS.text, { each: true })
  segments?: string[];

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) winIndex?: number;
  @IsOptional() @IsString() @MaxLength(20) spinLabel?: string;
  @IsOptional() @IsString() @MaxLength(40) prize?: string;
  @IsOptional() @IsString() @MaxLength(40) coverText?: string;
  @IsOptional() @IsString() @MaxLength(40) revealAllText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(GAME_LIMITS.boxes)
  @ArrayMaxSize(GAME_LIMITS.boxes)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  boxPrizes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(GAME_LIMITS.minQuestions)
  @ArrayMaxSize(GAME_LIMITS.maxQuestions)
  @ValidateNested({ each: true })
  @Type(() => GameQuizQuestionDto)
  questions?: GameQuizQuestionDto[];

  @IsOptional() @IsString() @MaxLength(GAME_LIMITS.text) resultTitle?: string;
}

export class CreateLandingFromTemplateDto extends LandingBehaviorDto {
  @IsString()
  name: string;

  @IsIn(TEMPLATE_IDS)
  templateId: string;

  @IsOptional() @IsString() primaryColor?: string;
  @IsOptional() @IsString() bgColor?: string;
  @IsOptional() @IsString() gradientFrom?: string;
  @IsOptional() @IsString() gradientTo?: string;
  @IsOptional() @IsString() buttonText?: string;
  @IsOptional() @IsString() channelTitle?: string;
  @IsOptional() @IsString() channelDescription?: string;
  @IsOptional() @IsString() channelAvatar?: string;
  @IsOptional() @IsString() subscribersCount?: string;
  // Слово после числа подписчиков (запрос пользователя 2026-07-21, "команды будут работать в
  // разных странах") — свободная строка, не enum: пресеты ru/en/es только в UI (см.
  // apps/web LandingContentCard), бэкенд принимает любое значение, включая кастомное.
  @IsOptional() @IsString() subscribersLabel?: string;

  // age-gate-invite (запрос пользователя 2026-08-18) — единственный шаблон с двумя попапами,
  // каждый текст/кнопка обоих попапов редактируется отдельно (см. LandingsService.getTemplates
  // и createFromTemplate/update).
  @IsOptional() @IsString() popup1Title?: string;
  @IsOptional() @IsString() popup1Text?: string;
  @IsOptional() @IsString() popup1YesText?: string;
  @IsOptional() @IsString() popup1NoText?: string;
  @IsOptional() @IsString() popup2Title?: string;
  @IsOptional() @IsString() popup2Text?: string;
  @IsOptional() @IsString() popup2ButtonText?: string;

  // countdown-urgency (запрос пользователя 2026-09-27) — LOCK_TEXT/SPOTS_TEXT свободный текст,
  // как и остальные текстовые поля выше; countdownMinutes идёт напрямую в inline-скрипт таймера
  // на странице (var totalMinutes = {{COUNTDOWN_MINUTES}};), поэтому только цифры — не строка
  // произвольного формата, как у остальных customizableFields.
  @IsOptional() @IsString() lockText?: string;
  @IsOptional() @IsString() spotsText?: string;
  @IsOptional() @Matches(/^\d{1,4}$/, { message: 'countdownMinutes должно быть числом от 1 до 4 цифр' }) countdownMinutes?: string;

  // null — явный сброс всех настроек игры на дефолт, как у countdownConfig/extraPopupConfig.
  @IsOptional()
  @ValidateIf((o) => o.gameConfig !== null)
  @ValidateNested()
  @Type(() => GameConfigDto)
  gameConfig?: GameConfigDto | null;

  // Конструктор (шаблон builder, 2026-10-20) — оформление и вопросы, см. builder.util.ts.
  @IsOptional()
  @ValidateIf((o) => o.builderConfig !== null)
  @IsObject()
  builderConfig?: Record<string, unknown> | null;

  // Визуальный редактор Puck (2026-10-21): состояние редактора и собранная им разметка — всегда
  // вместе, см. puck.util.ts. Размер проверяет сервис.
  @IsOptional() @IsObject() puckData?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(700_000) puckHtml?: string;

  @IsOptional() @IsString() metaTitle?: string;
  @IsOptional() @IsString() metaDescription?: string;
}
