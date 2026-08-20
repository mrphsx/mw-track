import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Permission, UserRole } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SubscriptionLimit } from '../../common/decorators/subscription-limit.decorator';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { StatsPeriodDto } from '../../common/dto/stats-period.dto';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveScopedBuyerId } from '../../common/buyer-scope.util';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { LeaderboardFunnelQueryDto } from './dto/leaderboard-funnel-query.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private projectsService: ProjectsService,
    private permissionsService: PermissionsService,
    private prisma: PrismaService,
  ) {}

  @Get()
  findAll(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.projectsService.findAll(companyId, user.userId, user.role);
  }

  // Компания-wide сводка на главной странице (запрос пользователя 2026-08-06) — литеральный
  // путь до 'GET :id' (тот же приём, что уже используют 'stats/best-time' у PushesController и
  // т.п.), иначе Nest принял бы 'company-stats' за значение :id.
  @Get('company-stats')
  getCompanyStats(@Company() companyId: string, @CurrentUser() user: AuthUser, @Query() periodQuery: StatsPeriodDto) {
    return this.projectsService.getCompanyStats(companyId, user.userId, user.role, periodQuery);
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

  // Багфикс 2026-07-28 (аудит разрешений сотрудников, дыра найдена — ни assertAccess, ни
  // разрешение раньше не проверялись вообще). Настройки проекта (домены/таймзона/трекинг-
  // переключатели) теперь — разрешение PROJECTS_EDIT, выдаётся per-project как и остальные.
  @Patch(':id')
  async update(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateProjectDto) {
    await this.projectsService.assertAccess(id, companyId, user.userId, user.role, [Permission.PROJECTS_EDIT]);
    return this.projectsService.update(id, companyId, dto);
  }

  // Архивация/перегенерация токенов — необратимо/чувствительно, сознательно НЕ разрешение
  // (нет способа выдать их per-project тоньше, чем "весь проект"), только Owner/Admin.
  @Delete(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  archive(@Param('id') id: string, @Company() companyId: string) {
    return this.projectsService.archive(id, companyId);
  }

  @Post(':id/tokens')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  regenerateTokens(@Param('id') id: string, @Company() companyId: string) {
    return this.projectsService.regenerateTokens(id, companyId);
  }

  // Тот же баг-репорт — отдавал publicToken/secretKey-контекст любого проекта компании без
  // проверки принадлежности. Здесь достаточно обычного членства (assertAccess без permission),
  // как у findOne выше — снипет нужен любому, кто работает с проектом, не только Owner/Admin.
  @Get(':id/snippet')
  async getSnippet(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(id, companyId, user.userId, user.role);
    return this.projectsService.getSnippet(id, companyId);
  }

  // Багфикс, найден при проектировании гранулярных прав (2026-07-17): эти 4 роута статистики
  // раньше не звали assertAccess вообще — любой авторизованный пользователь компании мог
  // смотреть статистику ЛЮБОГО проекта, просто зная его id, независимо от ProjectAccess.
  @Get(':id/overview')
  async getOverview(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query('days') days?: string) {
    await this.projectsService.assertAccess(id, companyId, user.userId, user.role, [Permission.STATS_VIEW]);
    return this.projectsService.getOverview(id, companyId, days ? parseInt(days, 10) : 30);
  }

  @Get(':id/ad-breakdown')
  async getAdBreakdown(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query() period: StatsPeriodDto) {
    await this.projectsService.assertAccess(id, companyId, user.userId, user.role, [Permission.STATS_VIEW]);
    const scopedBuyerId = await resolveScopedBuyerId(this.prisma, user.userId, user.role);
    return this.projectsService.getAdBreakdown(id, companyId, period, scopedBuyerId);
  }

  // Топ баеров/выручка (запрос пользователя 2026-07-17: "что видят в статистике а что нет")
  // частично скрываются — не 403 всего роута, а вырезание конкретных полей, поэтому проверка
  // ручная (PermissionsService.hasPermission), не через assertAccess: без
  // STATS_VIEW_TEAM_LEADERBOARDS человек не видит рейтинг команды (конкурентно-чувствительно)
  // вообще, остальные 3 лидерборда (пиксели/лэндинги/кампании — про ассеты, не про людей)
  // видит; без STATS_VIEW_REVENUE везде, где видны деньги, поле обнуляется, а не удаляется —
  // фронт ждёт число, не undefined.
  @Get(':id/leaderboards')
  async getLeaderboards(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query() period: StatsPeriodDto) {
    await this.projectsService.assertAccess(id, companyId, user.userId, user.role, [Permission.STATS_VIEW]);
    const scopedBuyerId = await resolveScopedBuyerId(this.prisma, user.userId, user.role);
    const data = await this.projectsService.getLeaderboards(id, companyId, period, scopedBuyerId);

    // "Только свои клиенты" (запрос пользователя 2026-08-03) — категория "buyers" ранжирует
    // против других баеров, при активном скоупе это бессмысленно (и утечка чужих имён/выручки),
    // всегда обнуляем независимо от STATS_VIEW_TEAM_LEADERBOARDS.
    if (scopedBuyerId || !(await this.permissionsService.hasPermission(user.userId, id, user.role, Permission.STATS_VIEW_TEAM_LEADERBOARDS))) {
      data.buyers = [];
      // "БЕЗ БАЕРА" (запрос пользователя 2026-08-09) — обнуляем вместе с самим списком buyers:
      // осиротевшая строка "без баера" без единой видимой строки с баерами была бы непонятной
      // сама по себе, та же граница видимости, что и у buyers целиком.
      data.buyersUnattributed = { clients: 0, revenue: 0 };
    }
    if (!(await this.permissionsService.hasPermission(user.userId, id, user.role, Permission.STATS_VIEW_REVENUE))) {
      data.buyers = data.buyers.map((b) => ({ ...b, revenue: 0 }));
      data.landings = data.landings.map((l) => ({ ...l, revenue: 0 }));
      data.campaigns = data.campaigns.map((c) => ({ ...c, revenue: 0 }));
      // pixels теперь тоже несёт revenue (баг-фикс 2026-07-28, раньше было только conversions —
      // счётчик, не деньги) — та же граница видимости, что и у остальных трёх.
      data.pixels = data.pixels.map((p) => ({ ...p, revenue: 0 }));
      // sources (запрос пользователя 2026-08-18) — та же граница, что и у pixels/campaigns/
      // landings (не про людей, просто обнуляем деньги).
      data.sources = data.sources.map((s) => ({ ...s, revenue: 0 }));
      data.buyersUnattributed.revenue = 0;
      data.pixelsUnattributed.revenue = 0;
      data.campaignsUnattributed.revenue = 0;
      data.sourcesUnattributed.revenue = 0;
    }

    return data;
  }

  // Полный список одной категории (не top-5) для отдельной страницы "сравнить все" (запрос
  // пользователя 2026-08-19). Та же видимость прав, что и у getLeaderboards выше — "buyers"
  // требует STATS_VIEW_TEAM_LEADERBOARDS и пуст при активном "только свои клиенты" скоупе,
  // выручка везде обнуляется без STATS_VIEW_REVENUE, а не удаляется из ответа.
  @Get(':id/leaderboards/:category/full')
  async getLeaderboardFull(
    @Param('id') id: string,
    @Param('category') category: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query() period: StatsPeriodDto,
  ) {
    await this.projectsService.assertAccess(id, companyId, user.userId, user.role, [Permission.STATS_VIEW]);
    const scopedBuyerId = await resolveScopedBuyerId(this.prisma, user.userId, user.role);

    const categories = ['buyers', 'pixels', 'landings', 'campaigns', 'sources'] as const;
    if (!(categories as readonly string[]).includes(category)) throw new BadRequestException('Неизвестная категория лидерборда');

    if (
      category === 'buyers' &&
      (scopedBuyerId || !(await this.permissionsService.hasPermission(user.userId, id, user.role, Permission.STATS_VIEW_TEAM_LEADERBOARDS)))
    ) {
      return { items: [] };
    }

    const items = await this.projectsService.getLeaderboardFull(id, companyId, category as (typeof categories)[number], period, scopedBuyerId);

    if (!(await this.permissionsService.hasPermission(user.userId, id, user.role, Permission.STATS_VIEW_REVENUE))) {
      return { items: items.map((i) => ({ ...i, revenue: 0 })) };
    }
    return { items };
  }

  // Развёрнутая воронка по конкретным top-5 id одной категории лидерборда (запрос пользователя
  // 2026-07-27) — вызывается фронтом только при открытии соответствующей вкладки (лениво,
  // см. комментарий у ProjectsService.getLeaderboardFunnel), ids — уже известные id из ответа
  // getLeaderboards выше, отдаются фронтом обратно через ?ids=a,b,c.
  @Get(':id/leaderboards/:category/funnel')
  async getLeaderboardFunnel(
    @Param('id') id: string,
    @Param('category') category: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query() query: LeaderboardFunnelQueryDto,
  ) {
    await this.projectsService.assertAccess(id, companyId, user.userId, user.role, [Permission.STATS_VIEW]);
    const scopedBuyerId = await resolveScopedBuyerId(this.prisma, user.userId, user.role);

    const categories = ['buyers', 'pixels', 'landings', 'campaigns', 'sources'] as const;
    if (!(categories as readonly string[]).includes(category)) throw new BadRequestException('Неизвестная категория лидерборда');
    // scopedBuyerId — та же причина, что и в getLeaderboards выше: "buyers" ранжирует против
    // других баеров, при активном скоупе всегда пусто, независимо от разрешения.
    if (
      category === 'buyers' &&
      (scopedBuyerId || !(await this.permissionsService.hasPermission(user.userId, id, user.role, Permission.STATS_VIEW_TEAM_LEADERBOARDS)))
    ) {
      return { items: [] };
    }

    // 200, не 10 (запрос пользователя 2026-08-19: "забыл добавить всю информацию про конверсию,
    // как это есть в разделе ТОП" — новая страница "Сравнить все" запрашивает воронку сразу для
    // ВСЕХ строк полного списка, не только top-5) — тот же потолок, что у самого полного списка
    // (getLeaderboardFull), запросы внутри getLeaderboardFunnel уже батчат IN (...ids) одним
    // запросом на категорию, не по одному id, так что рост с 10 до 200 не даёт N+1.
    const ids = (query.ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200);

    const data = await this.projectsService.getLeaderboardFunnel(id, companyId, category as (typeof categories)[number], ids, query, scopedBuyerId);

    if (!(await this.permissionsService.hasPermission(user.userId, id, user.role, Permission.STATS_VIEW_REVENUE))) {
      return { items: data.items.map((i) => ({ ...i, revenue: 0 })) };
    }
    return data;
  }

  @Get(':id/pixel-logs')
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
    await this.projectsService.assertAccess(id, companyId, user.userId, user.role, [Permission.STATS_VIEW]);
    return this.projectsService.getPixelLogs(
      id,
      companyId,
      {
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        pixelId,
        status,
        eventName,
      },
      // curl-команда с реальным access_token пикселя (запрос пользователя 2026-07-29, "чтобы
      // Owner мог просто взять ссылку и вставить в cmd") — секрет, поэтому строго только для
      // роли OWNER, не ADMIN и не остальных.
      user.role === 'OWNER',
    );
  }

  // Управление операторами проекта (запрос пользователя 2026-07-31: доступ Operator к
  // проекту больше не назначается при создании участника — только здесь или через карточку
  // оператора на /team). assertCanAccessTeamManagement/assertOperatorAdminScope — те же
  // хелперы, что и у /team, НЕ @Roles() (см. их комментарий про ранговую модель RolesGuard).
  @Get(':id/operators')
  async listOperators(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.projectsService.listProjectOperators(id, companyId, user.userId, user.role);
  }

  // Company-wide, не отфильтровано по пересечению проектов Оператор-админа (подтверждено
  // AskUserQuestion 2026-07-31) — иначе только что созданного оператора с 0 проектов
  // Оператор-админу было бы неоткуда взять. Только имя/email — без деталей чужого доступа.
  @Get(':id/operators/candidates')
  async listOperatorCandidates(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.projectsService.listOperatorCandidates(id, companyId, user.userId, user.role);
  }

  @Post(':id/operators')
  async addOperator(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body('userId') userId: string,
  ) {
    return this.projectsService.addOperatorToProject(id, companyId, user.userId, user.role, userId);
  }

  @Delete(':id/operators/:userId')
  async removeOperator(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectsService.removeOperatorFromProject(id, companyId, user.userId, user.role, userId);
  }
}
