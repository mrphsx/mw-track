import { IsOptional, IsString } from 'class-validator';
import { StatsPeriodDto } from '../../../common/dto/stats-period.dto';

// Багфикс 2026-07-28 (баг-репорт пользователя: "property ids should not exist", 400 на каждый
// запрос воронки лидерборда): @Query() period: StatsPeriodDto без имени биндит ВЕСЬ query-объект
// целиком, включая ids — глобальный ValidationPipe (whitelist: true, forbidNonWhitelisted: true,
// см. main.ts) отклонял его, потому что StatsPeriodDto ничего не знает про ids. Один DTO на весь
// query — единственный корректный способ сочетать @Query() без имени с доп. полем в NestJS.
export class LeaderboardFunnelQueryDto extends StatsPeriodDto {
  @IsOptional()
  @IsString()
  ids?: string;
}
