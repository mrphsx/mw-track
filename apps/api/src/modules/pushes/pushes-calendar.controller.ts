import { Controller, Get, Query } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/permissions/require-permission.decorator';
import { ProjectsService } from '../projects/projects.service';
import { PushesService } from './pushes.service';

// Календарь рассылок по всей компании сразу (запрос пользователя 2026-07-19, "так же можно и
// глобальный календарь такой под все проекты") — без @Roles(), видимость сама ограничена
// набором доступных проектов (ProjectsService.getAccessibleProjectIds), тот же принцип, что и
// у /audience/overlap: Buyer/Operator видят календарь только по своим назначенным проектам.
@Controller('pushes')
export class PushesCalendarController {
  constructor(
    private pushesService: PushesService,
    private projectsService: ProjectsService,
  ) {}

  @Get('scheduled-summary')
  @RequirePermission(Permission.PUSHES_VIEW)
  async scheduledSummary(@Company() companyId: string, @CurrentUser() user: AuthUser, @Query('month') month: string) {
    const projectIds = await this.projectsService.getAccessibleProjectIds(companyId, user.userId, user.role);
    return this.pushesService.getGlobalScheduledSummary(projectIds, month);
  }

  @Get('scheduled-day')
  @RequirePermission(Permission.PUSHES_VIEW)
  async scheduledDay(@Company() companyId: string, @CurrentUser() user: AuthUser, @Query('date') date: string) {
    const projectIds = await this.projectsService.getAccessibleProjectIds(companyId, user.userId, user.role);
    return this.pushesService.getScheduledForDay(projectIds, date);
  }
}
