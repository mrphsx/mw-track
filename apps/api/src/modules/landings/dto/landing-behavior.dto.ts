import { IsBoolean, IsOptional, IsString, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Тексты попапа-подсказки (запрос пользователя 2026-08-27, "форма для замены текстов как у
// конкурента", дефолт — английский, задаётся встроенным дефолтом в SDK, не здесь) — каждое поле
// независимо опционально, пустое/отсутствующее значение = SDK берёт свой дефолт для этого
// конкретного ключа. iosSteps/androidSteps — многострочные, перевод строки = отдельный шаг
// (нумеруются в SDK на рендере, не здесь).
export class TiktokHintTextsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  iosSteps?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  androidSteps?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  openButtonText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  copyButtonText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  copiedText?: string;
}

// Авторедирект и Lead-переключатели — общие для всех типов лендинга (TEMPLATE/CUSTOM/EXTERNAL) и
// для создания, и для редактирования (запрос пользователя 2026-07-03: "внедрить и при создании,
// а не только при редактировании"). Вынесено в отдельный класс, чтобы не дублировать
// валидаторы между CreateLandingFromTemplateDto и UpdateLandingDto. Конкретные ПРАВИЛА клоакинга
// сюда больше НЕ входят — с 2026-09-24 это отдельный движок (CloakingRule/CloakingCondition, см.
// dto/cloaking-rule.dto.ts) со своими роутами; cloakingEnabled остаётся здесь как был — это
// просто общий выключатель "проверять ли вообще правила ниже", а не конкретное правило.
export class LandingBehaviorDto {
  @IsOptional()
  @IsBoolean()
  autoRedirect?: boolean;

  // Два независимых переключателя отправки Lead (запрос пользователя 2026-09-15, по образцу
  // настроек конкурирующей СРМ). Дефолты живут в schema.prisma, а не здесь: leadOnClick=true,
  // leadOnAutoRedirect=false — существующее поведение не меняется, пока арендатор сам не
  // включит второй переключатель осознанно.
  @IsOptional()
  @IsBoolean()
  leadOnClick?: boolean;

  @IsOptional()
  @IsBoolean()
  leadOnAutoRedirect?: boolean;

  @IsOptional()
  @IsBoolean()
  cloakingEnabled?: boolean;

  // Доп. инструкции для TikTok (запрос пользователя 2026-08-25) — см. Landing.tiktokBrowserHint
  // в schema.prisma для полного объяснения проблемы и подхода.
  @IsOptional()
  @IsBoolean()
  tiktokBrowserHint?: boolean;

  // См. TiktokHintTextsDto выше. null — способ явно сбросить все тексты на дефолт разом (тот же
  // приём, что и у cloakingRedirectUrl с пустой строкой), поэтому пропускаем @ValidateNested при
  // null, а не отклоняем как невалидный объект.
  @IsOptional()
  @ValidateIf((o) => o.tiktokHintTexts !== null)
  @ValidateNested()
  @Type(() => TiktokHintTextsDto)
  tiktokHintTexts?: TiktokHintTextsDto | null;
}
