import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AutomationEnrollmentStatus } from '@prisma/client';

// Фильтр/пагинация для GET .../scenarios/:id/stats — запрос пользователя 2026-07-25 ("список
// клиентов которые прошли, в ожидании, ошибка"). status фильтрует список клиентов, счётчики
// (BotScenariosService.getStats) всегда считаются по ВСЕМ статусам независимо от фильтра.
export class ScenarioStatsQueryDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'COMPLETED', 'EXITED', 'FAILED'])
  status?: AutomationEnrollmentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
