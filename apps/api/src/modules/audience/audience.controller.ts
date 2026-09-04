import { Controller, Get, Param, Query } from '@nestjs/common';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { StatsPeriodDto } from '../../common/dto/stats-period.dto';
import { OverlapDetailQueryDto } from './dto/overlap-detail-query.dto';
import { AudienceService } from './audience.service';

// Без @Roles() — видимость сама по себе ограничена набором доступных проектов
// (см. AudienceService.getAccessibleProjectIds), тот же принцип, что у /landings
// company-wide и /pushes: Buyer/Operator видят пересечения только между своими проектами.
@Controller('audience')
export class AudienceController {
  constructor(private audienceService: AudienceService) {}

  @Get('overlap')
  getOverlapMatrix(@Company() companyId: string, @CurrentUser() user: AuthUser, @Query() period: StatsPeriodDto) {
    return this.audienceService.getOverlapMatrix(companyId, user.userId, user.role, period);
  }

  // Сводка пары (запрос пользователя 2026-08-31, отдельная страница пересечения "сколько
  // уникальных и дубликатов") — статический сегмент /summary после параметров не конфликтует
  // с параметризованным getOverlapDetail ниже (Nest матчит по полному пути целиком, не по
  // префиксу), порядок методов в файле роли не играет.
  @Get('overlap/:projectAId/:projectBId/summary')
  getOverlapPairSummary(
    @Param('projectAId') projectAId: string,
    @Param('projectBId') projectBId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query() period: StatsPeriodDto,
  ) {
    return this.audienceService.getOverlapPairSummary(companyId, user.userId, user.role, projectAId, projectBId, period);
  }

  // page/limit/search/period — ОДИН комбинированный DTO (OverlapDetailQueryDto), не отдельные
  // @Query('page')/@Query('search') рядом с @Query() period — см. комментарий в самом DTO.
  @Get('overlap/:projectAId/:projectBId')
  getOverlapDetail(
    @Param('projectAId') projectAId: string,
    @Param('projectBId') projectBId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query() query: OverlapDetailQueryDto,
  ) {
    return this.audienceService.getOverlapDetail(
      companyId,
      user.userId,
      user.role,
      projectAId,
      projectBId,
      query.page || 1,
      Math.min(query.limit || 20, 100),
      query.search,
      query,
    );
  }
}
