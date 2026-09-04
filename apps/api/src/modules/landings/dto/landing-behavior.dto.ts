import { IsArray, IsBoolean, IsOptional, IsString, IsUrl, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
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

// Авторедирект и клоакинг — общие для всех типов лендинга (TEMPLATE/CUSTOM/EXTERNAL) и для
// создания, и для редактирования (запрос пользователя 2026-07-03: "внедрить и при создании,
// а не только при редактировании"). Вынесено в отдельный класс, чтобы не дублировать
// валидаторы между CreateLandingFromTemplateDto и UpdateLandingDto.
export class LandingBehaviorDto {
  @IsOptional()
  @IsBoolean()
  autoRedirect?: boolean;

  @IsOptional()
  @IsBoolean()
  cloakingEnabled?: boolean;

  // ISO 3166-1 alpha-2, верхний регистр (RU, US, ...) — сверяется 1-в-1 с cf-ipcountry/
  // geoip-lite в LandingRendererService, поэтому формат фиксирован на уровне валидации,
  // а не приводится регистронезависимо в рантайме на каждый запрос лендинга.
  @IsOptional()
  @IsArray()
  @Matches(/^[A-Z]{2}$/, { each: true, message: 'Код страны — 2 латинские буквы в верхнем регистре, например RU' })
  cloakingCountries?: string[];

  // Пустая строка — способ очистить ранее заданную ссылку (см. LandingsService.update),
  // поэтому пропускает @IsUrl, а не отклоняется валидацией как невалидный URL.
  @IsOptional()
  @ValidateIf((o) => o.cloakingRedirectUrl !== '')
  @IsUrl({ require_protocol: true })
  cloakingRedirectUrl?: string;

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
