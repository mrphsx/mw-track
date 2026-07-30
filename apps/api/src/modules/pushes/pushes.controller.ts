import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubscriptionLimit } from '../../common/decorators/subscription-limit.decorator';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
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
  async create(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreatePushDto) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PUSHES_CREATE]);
    return this.pushesService.create(projectId, dto);
  }

  @Get()
  async findAll(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PUSHES_VIEW]);
    return this.pushesService.findAll(projectId);
  }

  // Smart Push Timing (Фаза 3.4) — двухсегментный путь, с 'GET :id' (один сегмент) не
  // пересекается, но объявлен раньше для ясности, по тому же принципу, что и 'templates' в
  // LandingsController.
  @Get('stats/best-time')
  async bestTime(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PUSHES_VIEW]);
    return this.pushesService.getBestTimeStats(projectId);
  }

  // Календарь на странице создания рассылки (запрос пользователя 2026-07-18) — двухсегментный
  // путь, тот же приём, что и у 'stats/best-time' выше, объявлен раньше 'GET :id' по той же
  // причине.
  @Get('stats/scheduled-summary')
  async scheduledSummary(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('month') month: string,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PUSHES_VIEW]);
    return this.pushesService.getScheduledSummary(projectId, month);
  }

  // Список уже запланированных пушей на конкретный день внутри ЭТОГО проекта (запрос
  // пользователя 2026-07-19, "видеть на когда уже есть рассылки и сколько") — показывается под
  // календарём на странице создания рассылки, чтобы не создать вторую рассылку в то же время
  // не глядя. Тот же двухсегментный приём, что и у 'stats/best-time'/'stats/scheduled-summary'
  // выше, объявлен раньше 'GET :id' по той же причине.
  @Get('stats/scheduled-day')
  async scheduledDay(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('date') date: string,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PUSHES_VIEW]);
    return this.pushesService.getScheduledForDay([projectId], date);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PUSHES_VIEW]);
    return this.pushesService.findOne(id, projectId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePushDto,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PUSHES_CREATE]);
    return this.pushesService.update(id, projectId, dto);
  }

  @Post(':id/recalculate-audience')
  async recalculateAudience(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PUSHES_CREATE]);
    return this.pushesService.recalculateAudience(id, projectId);
  }

  @Post(':id/send')
  @SubscriptionLimit('pushes')
  @UseGuards(SubscriptionGuard)
  async send(@Param('id') id: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PUSHES_SEND]);
    return this.pushesService.send(id, projectId, companyId);
  }

  @Get(':id/logs')
  async findLogs(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PUSHES_VIEW]);
    return this.pushesService.findLogs(id, projectId, page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 50);
  }

  @Delete(':id')
  async cancel(@Param('id') id: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PUSHES_DELETE]);
    return this.pushesService.cancel(id, projectId);
  }
}
