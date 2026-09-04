import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';
import { StatsPeriod } from '../../../common/dto/stats-period.dto';

// Период + поиск по тексту (запрос пользователя 2026-08-29: "добавь периоды как на главной
// странице проекта... так же поиск по тексту") — тот же period/from/to формат, что и
// StatsPeriodDto/ClientFiltersDto, резолвится через ту же resolveStatsPeriod (часовой пояс
// проекта, календарно выровненные границы). Фильтрует PaymentDetailsLog.sentAt.
export class PaymentDetailsLogFiltersDto {
  @IsOptional()
  @IsIn(['today', 'yesterday', '7d', '30d', 'custom'])
  period?: StatsPeriod;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from должен быть в формате YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to должен быть в формате YYYY-MM-DD' })
  to?: string;

  // Простой case-insensitive contains по тексту сообщения.
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
  pageSize?: number;
}
