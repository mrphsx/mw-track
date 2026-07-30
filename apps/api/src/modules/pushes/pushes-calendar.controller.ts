import { Controller, Get, Query } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { PushesService } from './pushes.service';

// Календарь рассылок по всей компании сразу (запрос пользователя 2026-07-19, "так же можно и
// глобальный календарь такой под все проекты") — без @Roles(), видимость сама ограничена
// набором доступных проектов, теперь ещё и по конкретному PUSHES_VIEW-праву на каждом
// (getAccessibleProjectIds(..., Permission.PUSHES_VIEW), запрос пользователя 2026-07-28).
@Controller('pushes')
export class PushesCalendarController {
  constructor(
    private pushesService: PushesService,
    private projectsService: ProjectsService,
  ) {}

  @Get('scheduled-summary')
  async scheduledSummary(@Company() companyId: string, @CurrentUser() user: AuthUser, @Query('month') month: string) {
    const projectIds = await this.projectsService.getAccessibleProjectIds(companyId, user.userId, user.role, Permission.PUSHES_VIEW);
    return this.pushesService.getGlobalScheduledSummary(projectIds, month);
  }

  @Get('scheduled-day')
  async scheduledDay(@Company() companyId: string, @CurrentUser() user: AuthUser, @Query('date') date: string) {
    const projectIds = await this.projectsService.getAccessibleProjectIds(companyId, user.userId, user.role, Permission.PUSHES_VIEW);
    return this.pushesService.getScheduledForDay(projectIds, date);
  }
}
