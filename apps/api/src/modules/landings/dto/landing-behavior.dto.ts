import { IsArray, IsBoolean, IsOptional, IsUrl, Matches, ValidateIf } from 'class-validator';

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
}
