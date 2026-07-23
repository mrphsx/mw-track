import { IsIn, IsOptional, Matches } from 'class-validator';

export type StatsPeriod = 'today' | 'yesterday' | '7d' | '30d' | 'custom';

// Общий период для всех статистик страницы проекта (запрос пользователя 2026-07-17:
// "сегодня, вчера, 7 дней, 30 дней, кастомный период") — заменяет собой прежний плоский
// ?days=N. from/to обязательны только при period=custom, формат YYYY-MM-DD (без времени —
// границы суток считаются в зоне проекта, см. resolveStatsPeriod в timezone.util.ts).
export class StatsPeriodDto {
  @IsOptional()
  @IsIn(['today', 'yesterday', '7d', '30d', 'custom'])
  period?: StatsPeriod;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from должен быть в формате YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to должен быть в формате YYYY-MM-DD' })
  to?: string;
}
