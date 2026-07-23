import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubscriptionLimit } from '../../common/decorators/subscription-limit.decorator';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { RequirePermission } from '../../common/permissions/require-permission.decorator';
import { ProjectsService } from '../projects/projects.service';
import { PushesService } from './pushes.service';
import { CreatePushDto } from './dto/create-push.dto';
import { UpdatePushDto } from './dto/update-push.dto';

@Controller('projects/:projectId/pushes')
export class PushesController {
  constructor(
    private pushesService: PushesService,
    private projectsService: ProjectsService,
  ) {}

  @Post()
  @RequirePermission(Permission.PUSHES_CREATE)
  async create(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreatePushDto) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.pushesService.create(projectId, dto);
  }

  @Get()
  @RequirePermission(Permission.PUSHES_VIEW)
  async findAll(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.pushesService.findAll(projectId);
  }

  // Smart Push Timing (Фаза 3.4) — двухсегментный путь, с 'GET :id' (один сегмент) не
  // пересекается, но объявлен раньше для ясности, по тому же принципу, что и 'templates' в
  // LandingsController.
  @Get('stats/best-time')
  @RequirePermission(Permission.PUSHES_VIEW)
  async bestTime(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.pushesService.getBestTimeStats(projectId);
  }

  // Календарь на странице создания рассылки (запрос пользователя 2026-07-18) — двухсегментный
  // путь, тот же приём, что и у 'stats/best-time' выше, объявлен раньше 'GET :id' по той же
  // причине.
  @Get('stats/scheduled-summary')
  @RequirePermission(Permission.PUSHES_VIEW)
  async scheduledSummary(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('month') month: string,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.pushesService.getScheduledSummary(projectId, month);
  }

  // Список уже запланированных пушей на конкретный день внутри ЭТОГО проекта (запрос
  // пользователя 2026-07-19, "видеть на когда уже есть рассылки и сколько") — показывается под
  // календарём на странице создания рассылки, чтобы не создать вторую рассылку в то же время
  // не глядя. Тот же двухсегментный приём, что и у 'stats/best-time'/'stats/scheduled-summary'
  // выше, объявлен раньше 'GET :id' по той же причине.
  @Get('stats/scheduled-day')
  @RequirePermission(Permission.PUSHES_VIEW)
  async scheduledDay(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('date') date: string,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.pushesService.getScheduledForDay([projectId], date);
  }

  @Get(':id')
  @RequirePermission(Permission.PUSHES_VIEW)
  async findOne(@Param('id') id: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.pushesService.findOne(id, projectId);
  }

  @Patch(':id')
  @RequirePermission(Permission.PUSHES_CREATE)
  async update(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePushDto,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.pushesService.update(id, projectId, dto);
  }

  @Post(':id/recalculate-audience')
  @RequirePermission(Permission.PUSHES_CREATE)
  async recalculateAudience(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.pushesService.recalculateAudience(id, projectId);
  }

  @Post(':id/send')
  @RequirePermission(Permission.PUSHES_SEND)
  @SubscriptionLimit('pushes')
  @UseGuards(SubscriptionGuard)
  async send(@Param('id') id: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.pushesService.send(id, projectId, companyId);
  }

  @Get(':id/logs')
  @RequirePermission(Permission.PUSHES_VIEW)
  async findLogs(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.pushesService.findLogs(id, projectId, page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 50);
  }

  @Delete(':id')
  @RequirePermission(Permission.PUSHES_DELETE)
  async cancel(@Param('id') id: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.pushesService.cancel(id, projectId);
  }
}
