import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';
import { CloakingConditionField } from '@prisma/client';

// Один комбинированный DTO (page+limit+ruleId+field+from/to) — тот же приём, что у
// PaymentDetailsLogFiltersDto/OverlapDetailQueryDto: глобальный ValidationPipe с
// forbidNonWhitelisted:true проверяет ВСЮ query-строку разом, поэтому нельзя одновременно
// навесить @Query() и отдельные @Query('page')/... на один роут (см. CLAUDE.md, "Combined
// filter DTO pattern"). ruleId/field фильтруют CloakingLog.ruleId/matchedConditions
// (запрос пользователя 2026-09-25: "фильтровать логи кто по какому условию и когда был
// отфильтрован").
export class CloakingLogsQueryDto {
  @IsOptional()
  @IsString()
  ruleId?: string;

  @IsOptional()
  @IsIn([
    'COUNTRY', 'REGION', 'CITY', 'IP', 'REFERRER', 'USER_AGENT', 'X_REQUESTED_WITH', 'LANGUAGE',
    'BROWSER', 'BROWSER_VERSION', 'OS', 'OS_VERSION', 'DEVICE_TYPE', 'DEVICE_MODEL', 'PARAMETER',
    'DATE_BETWEEN', 'TIMETABLE', 'LIMIT_CLICKS', 'BOT', 'UNIQUENESS',
  ])
  field?: CloakingConditionField;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from должен быть в формате YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to должен быть в формате YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}
