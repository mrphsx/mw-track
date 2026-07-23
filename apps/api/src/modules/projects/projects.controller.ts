import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubscriptionLimit } from '../../common/decorators/subscription-limit.decorator';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { StatsPeriodDto } from '../../common/dto/stats-period.dto';
import { RequirePermission } from '../../common/permissions/require-permission.decorator';
import { hasPermission } from '../../common/permissions/permissions.util';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Get()
  findAll(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.projectsService.findAll(companyId, user.userId, user.role);
  }

  @Post()
  @SubscriptionLimit('projects')
  @UseGuards(SubscriptionGuard)
  create(@Company() companyId: string, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(companyId, dto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(id, companyId, user.userId, user.role);
    return this.projectsService.findOne(id, companyId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Company() companyId: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(id, companyId, dto);
  }

  @Delete(':id')
  archive(@Param('id') id: string, @Company() companyId: string) {
    return this.projectsService.archive(id, companyId);
  }

  @Post(':id/tokens')
  regenerateTokens(@Param('id') id: string, @Company() companyId: string) {
    return this.projectsService.regenerateTokens(id, companyId);
  }

  @Get(':id/snippet')
  getSnippet(@Param('id') id: string, @Company() companyId: string) {
    return this.projectsService.getSnippet(id, companyId);
  }

  // Багфикс, найден при проектировании гранулярных прав (2026-07-17): эти 4 роута статистики
  // раньше не звали assertAccess вообще — любой авторизованный пользователь компании мог
  // смотреть статистику ЛЮБОГО проекта, просто зная его id, независимо от ProjectAccess.
  @Get(':id/overview')
  @RequirePermission(Permission.STATS_VIEW)
  async getOverview(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query('days') days?: string) {
    await this.projectsService.assertAccess(id, companyId, user.userId, user.role);
    return this.projectsService.getOverview(id, companyId, days ? parseInt(days, 10) : 30);
  }

  @Get(':id/ad-breakdown')
  @RequirePermission(Permission.STATS_VIEW)
  async getAdBreakdown(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query() period: StatsPeriodDto) {
    await this.projectsService.assertAccess(id, companyId, user.userId, user.role);
    return this.projectsService.getAdBreakdown(id, companyId, period);
  }

  // Топ баеров/выручка (запрос пользователя 2026-07-17: "что видят в статистике а что нет")
  // частично скрываются — не 403 всего роута, а вырезание конкретных полей, поэтому проверка
  // ручная (hasPermission), не PermissionsGuard: без STATS_VIEW_TEAM_LEADERBOARDS человек не
  // видит рейтинг команды (конкурентно-чувствительно) вообще, остальные 3 лидерборда (пиксели/
  // лэндинги/кампании — про ассеты, не про людей) видит; без STATS_VIEW_REVENUE везде, где
  // видны деньги, поле обнуляется, а не удаляется — фронт ждёт число, не undefined.
  @Get(':id/leaderboards')
  @RequirePermission(Permission.STATS_VIEW)
  async getLeaderboards(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query() period: StatsPeriodDto) {
    await this.projectsService.assertAccess(id, companyId, user.userId, user.role);
    const data = await this.projectsService.getLeaderboards(id, companyId, period);

    if (!hasPermission(user, Permission.STATS_VIEW_TEAM_LEADERBOARDS)) {
      data.buyers = [];
    }
    if (!hasPermission(user, Permission.STATS_VIEW_REVENUE)) {
      data.buyers = data.buyers.map((b) => ({ ...b, revenue: 0 }));
      data.landings = data.landings.map((l) => ({ ...l, revenue: 0 }));
      data.campaigns = data.campaigns.map((c) => ({ ...c, revenue: 0 }));
    }

    return data;
  }

  @Get(':id/pixel-logs')
  @RequirePermission(Permission.STATS_VIEW)
  async getPixelLogs(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('pixelId') pixelId?: string,
    @Query('status') status?: string,
    @Query('eventName') eventName?: string,
  ) {
    await this.projectsService.assertAccess(id, companyId, user.userId, user.role);
    return this.projectsService.getPixelLogs(id, companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      pixelId,
      status,
      eventName,
    });
  }
}
