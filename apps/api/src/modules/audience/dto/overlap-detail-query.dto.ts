import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';
import { StatsPeriod } from '../../../common/dto/stats-period.dto';

// Один комбинированный DTO для period+page+limit+search (запрос пользователя 2026-08-31,
// период на странице пересечения) — тот же приём, что PaymentDetailsLogFiltersDto: глобальный
// ValidationPipe с forbidNonWhitelisted:true проверяет ВСЮ query-строку разом, поэтому нельзя
// одновременно навесить @Query() StatsPeriodDto и отдельные @Query('page')/@Query('search') на
// один и тот же роут (см. CLAUDE.md, "Combined filter DTO pattern") — 400 на первый же реальный
// запрос с обоими наборами параметров.
export class OverlapDetailQueryDto {
  @IsOptional()
  @IsIn(['today', 'yesterday', '7d', '30d', 'custom'])
  period?: StatsPeriod;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from должен быть в формате YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to должен быть в формате YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @IsString()
  search?: string;

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
