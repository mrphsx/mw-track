import { IsBoolean, IsOptional } from 'class-validator';

// Все три поля опциональны — PATCH обновляет только переданные, остальные остаются как есть
// (тот же паттерн частичного обновления, что и везде в проекте).
export class UpdateCompanyRestrictionsDto {
  @IsOptional()
  @IsBoolean()
  pushesBlocked?: boolean;

  @IsOptional()
  @IsBoolean()
  domainsBlocked?: boolean;

  @IsOptional()
  @IsBoolean()
  isSuspended?: boolean;
}
