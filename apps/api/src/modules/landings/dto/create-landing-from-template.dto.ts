import { IsIn, IsOptional, IsString } from 'class-validator';
import { LandingBehaviorDto } from './landing-behavior.dto';

// Баг-репорт пользователя 2026-07-15: "при выборе telegram тёмный или светлый пишет ошибка
// валидации" — этот whitelist дублирует список из LandingsService.getTemplates(), но не
// обновлялся при добавлении новых шаблонов (telegram-light/dark 2026-07-04, tg-invite-dark/
// light 2026-07-14/15), из-за чего @IsIn молча резал ЛЮБОЙ templateId не из первых трёх.
// Держать в синхроне с LandingsService.getTemplates() при добавлении новых шаблонов.
const TEMPLATE_IDS = ['minimal', 'gradient', 'dark', 'telegram-light', 'telegram-dark', 'tg-invite-dark', 'tg-invite-light', 'age-gate-invite'];

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

  @IsOptional() @IsString() metaTitle?: string;
  @IsOptional() @IsString() metaDescription?: string;
}
