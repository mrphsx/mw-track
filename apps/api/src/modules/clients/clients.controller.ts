import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Permission, UserRole } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { StatsPeriodDto } from '../../common/dto/stats-period.dto';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveScopedBuyerId } from '../../common/buyer-scope.util';
import { resolveStatsPeriod } from '../../common/timezone.util';
import { buildProjectStatsCsv } from '../projects/project-stats-export.util';
import { withUtf8Bom } from '../../common/csv.util';
import { ProjectsService } from '../projects/projects.service';
import { ClientsService } from './clients.service';
import { ClientsRepository } from './clients.repository';
import { PurchasesService } from './purchases.service';
import { ClientFiltersDto } from './dto/client-filters.dto';
import { CreatePurchaseDto } from './dto/create-purchase.dto';

@Controller('projects/:projectId/clients')
export class ClientsController {
  constructor(
    private clientsService: ClientsService,
    private clientsRepository: ClientsRepository,
    private purchasesService: PurchasesService,
    private projectsService: ProjectsService,
    private permissionsService: PermissionsService,
    private prisma: PrismaService,
  ) {}

  @Get()
  async findMany(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query() filters: ClientFiltersDto) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CLIENTS_VIEW]);
    const canViewCrossProject = await this.permissionsService.hasPermission(
      user.userId,
      projectId,
      user.role,
      Permission.CLIENTS_VIEW_CROSS_PROJECT,
    );
    const scopedBuyerId = await resolveScopedBuyerId(this.prisma, user.userId, user.role);
    // Источник трафика в списке (запрос пользователя 2026-08-18: "везде, кроме аккаунта
    // оператора") — тот же критерий, что уже используется для canViewTrafficSource на карточке
    // одного клиента (getClientDetail ниже).
    const canViewTrafficSource = user.role !== UserRole.OPERATOR;
    return this.clientsService.findMany(projectId, filters, companyId, canViewCrossProject, scopedBuyerId, canViewTrafficSource);
  }

  @Get('stats')
  async stats(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query() period: StatsPeriodDto,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.STATS_VIEW]);
    const scopedBuyerId = await resolveScopedBuyerId(this.prisma, user.userId, user.role);
    const stats = await this.clientsRepository.getProjectStats(projectId, period, scopedBuyerId);

    // Выручка (запрос пользователя 2026-07-17: "что видят в статистике а что нет") —
    // без STATS_VIEW_REVENUE денежные поля обнуляются, а не удаляются, фронт ждёт число.
    if (!(await this.permissionsService.hasPermission(user.userId, projectId, user.role, Permission.STATS_VIEW_REVENUE))) {
      return {
        ...stats,
        totalRevenue: 0,
        avgOrderValue: 0,
        dailyRevenue: stats.dailyRevenue.map((d) => ({ ...d, amount: 0 })),
        dailyDeposits: stats.dailyDeposits.map((d) => ({ ...d, fdRevenue: 0, rdRevenue: 0 })),
      };
    }
    return stats;
  }

  @Get('funnel')
  async funnel(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query() period: StatsPeriodDto,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.STATS_VIEW]);
    const scopedBuyerId = await resolveScopedBuyerId(this.prisma, user.userId, user.role);
    return this.clientsRepository.getConversionFunnel(projectId, period, scopedBuyerId);
  }

  // Скачивание статистики проекта за период одним CSV-файлом (запрос пользователя 2026-09-08) —
  // те же данные и то же разрешение-скоупинг, что уже показывает сама страница проекта: общая
  // статистика + воронка + топ-лидерборды (только при STATS_VIEW_TEAM_LEADERBOARDS и без
  // активного buyer-скоупа — тот же критерий, что и у GET .../leaderboards) + разбивка по
  // объявлениям. Деньги обнуляются, а не убираются из отчёта, без STATS_VIEW_REVENUE — тот же
  // принцип, что везде в этом контроллере/ProjectsController.
  @Get('stats/export')
  async exportStats(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query() period: StatsPeriodDto,
    @Res() res: Response,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.STATS_VIEW]);
    const scopedBuyerId = await resolveScopedBuyerId(this.prisma, user.userId, user.role);
    const canViewRevenue = await this.permissionsService.hasPermission(user.userId, projectId, user.role, Permission.STATS_VIEW_REVENUE);
    const canViewLeaderboards =
      !scopedBuyerId && (await this.permissionsService.hasPermission(user.userId, projectId, user.role, Permission.STATS_VIEW_TEAM_LEADERBOARDS));

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
    const { since, until } = await resolveStatsPeriod(this.prisma, project.timezone, period);
    const periodLabel = `${since.toISOString().slice(0, 10)} — ${until.toISOString().slice(0, 10)}`;

    const categories = ['buyers', 'pixels', 'landings', 'campaigns', 'sources'] as const;
    const [stats, funnel, adBreakdown, leaderboardRows] = await Promise.all([
      this.clientsRepository.getProjectStats(projectId, period, scopedBuyerId),
      this.clientsRepository.getConversionFunnel(projectId, period, scopedBuyerId),
      this.projectsService.getAdBreakdown(projectId, companyId, period, scopedBuyerId),
      canViewLeaderboards
        ? Promise.all(categories.map((category) => this.projectsService.getLeaderboardFull(projectId, companyId, category, period, scopedBuyerId)))
        : Promise.resolve(null),
    ]);

    const leaderboards = leaderboardRows
      ? {
          buyers: leaderboardRows[0],
          pixels: leaderboardRows[1],
          landings: leaderboardRows[2],
          campaigns: leaderboardRows[3],
          sources: leaderboardRows[4],
        }
      : null;

    const csv = buildProjectStatsCsv({ periodLabel, stats, funnel, adBreakdown, leaderboards, canViewRevenue });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="project_stats_${projectId}.csv"`);
    res.send(withUtf8Bom(csv));
  }

  // "Моя статистика" (Operator, запрос пользователя 2026-07-30) — сколько клиентов вообще на
  // проекте + сколько депозитов ЛИЧНО зарегистрировал этот сотрудник (Purchase.registeredBy,
  // не "клиенты назначенные оператору" — такой привязки в модели нет). STATS_VIEW переиспользован
  // (уже в дефолтном наборе Operator), не заводим отдельное разрешение под один эндпоинт.
  @Get('my-stats')
  async myStats(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query() period: StatsPeriodDto,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.STATS_VIEW]);
    return this.clientsRepository.getMyStats(projectId, user.userId, period);
  }

  // Полный экспорт списка клиентов (запрос пользователя 2026-09-08) — те же фильтры, что и у
  // самого списка (findMany выше), поэтому экспорт всегда отражает ровно то, что отфильтровано
  // на странице в момент клика на "Скачать". CLIENTS_EXPORT — та же разрешение, что уже гейтит
  // exportLookalike ниже (экспорт всех данных клиента — логическое продолжение того же права).
  @Get('export')
  async exportClients(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query() filters: ClientFiltersDto,
    @Res() res: Response,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CLIENTS_EXPORT]);
    const scopedBuyerId = await resolveScopedBuyerId(this.prisma, user.userId, user.role);
    const canViewTrafficSource = user.role !== UserRole.OPERATOR;
    const csv = await this.clientsService.exportClientsCsv(projectId, filters, scopedBuyerId, canViewTrafficSource);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="clients_${projectId}.csv"`);
    res.send(csv);
  }

  @Get('export/lookalike')
  async exportLookalike(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('onlyBuyers') onlyBuyers: string,
    @Res() res: Response,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CLIENTS_EXPORT]);
    const scopedBuyerId = await resolveScopedBuyerId(this.prisma, user.userId, user.role);
    const csv = await this.clientsService.exportForLookalike(projectId, onlyBuyers !== 'false', scopedBuyerId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="lookalike_${projectId}.csv"`);
    res.send(csv);
  }

  @Get(':clientId')
  async findOne(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CLIENTS_VIEW]);
    return this.clientsService.getClientDetail(clientId, companyId, user.role !== UserRole.OPERATOR);
  }

  @Get(':clientId/purchases')
  async purchases(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CLIENTS_VIEW]);
    await this.clientsService.findOne(clientId, companyId);
    return this.purchasesService.findByClient(clientId);
  }

  @Get(':clientId/events')
  async events(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CLIENTS_VIEW]);
    await this.clientsService.findOne(clientId, companyId);
    return this.clientsService.findEvents(clientId);
  }

  @Get(':clientId/pushes')
  async pushes(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CLIENTS_VIEW]);
    await this.clientsService.findOne(clientId, companyId);
    return this.clientsService.findPushLogs(clientId);
  }

  @Post(':clientId/purchases')
  async addPurchase(
    @Param('clientId') clientId: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @Body() dto: CreatePurchaseDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CLIENTS_EDIT]);
    await this.clientsService.findOne(clientId, companyId);
    return this.purchasesService.create(projectId, clientId, dto, user.userId);
  }

  @Delete(':clientId')
  async remove(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CLIENTS_DELETE]);
    await this.clientsService.softDelete(clientId, companyId);
    return { success: true };
  }

  // Кнопка "Зарегистрировать диалог" в списке клиентов (запрос пользователя 2026-07-21) —
  // третий способ зафиксировать диалог без подключения личного MTProto-аккаунта, для команд,
  // которые ведут переписку вообще вне Telegram-бота этого проекта. Тот же общий хвост
  // (ClientsService.recordManualDialogue → applyDialogueUpdate), что и у подтверждения
  // менеджером через бота — если диалог уже был зафиксирован любым из способов, событие в
  // Facebook/TikTok повторно не уйдёт (проверка isFirstMessage внутри).
  @Post(':clientId/dialogue')
  async registerDialogue(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CLIENTS_EDIT]);
    await this.clientsService.findOne(clientId, companyId);
    await this.clientsService.recordManualDialogue(clientId, projectId, 'CRM_BUTTON');
    return { success: true };
  }

  // Авторизованный (не @Public(), как у channel/landing avatar) — фото самого клиента
  // чувствительнее, чем фото канала/лендинга, которое и так видно всем подписчикам канала.
  //
  // Скачивает байты Telegram-файла напрямую через fetch(), НЕ через ChannelsService —
  // импорт ChannelsService как значения (для ModuleRef.get) сюда уже пробовался и уронил
  // боот (circular require на уровне Node/CommonJS: clients.controller -> channels.service ->
  // telegram.provider -> clients.service, замыкает цикл внутри самого ClientsModule раньше,
  // чем тот успевает доинициализироваться — ModuleRef защищает только от циклов в графе DI
  // Nest, но не от циклических require() на уровне файлов). Раз тут не нужен живой Bot-инстанс
  // (только bot token канала), проще и безопаснее продублировать двухшаговый Telegram-флоу
  // (getFile → скачать байты) без единого нового межмодульного импорта.
  @Get(':clientId/avatar')
  async avatar(
    @Param('clientId') clientId: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CLIENTS_VIEW]);
    const client = await this.clientsService.findOne(clientId, companyId);
    const channel = client.tgPhotoUrl ? await this.clientsService.getChannelBotToken(client.projectId) : null;

    if (!channel?.tgBotToken) {
      res.status(404).end();
      return;
    }

    try {
      const file = await fetch(`https://api.telegram.org/bot${channel.tgBotToken}/getFile?file_id=${client.tgPhotoUrl}`)
        .then((r) => r.json())
        .then((j) => j.result);
      const fileResponse = await fetch(`https://api.telegram.org/file/bot${channel.tgBotToken}/${file.file_path}`);
      if (!fileResponse.ok || !fileResponse.body) {
        res.status(404).end();
        return;
      }

      // Content-Type принудительно 'image/jpeg' — та же причина, что и у landing/channel
      // avatar: Telegram отдаёт 'application/octet-stream' для фото файлового сервера.
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(Buffer.from(await fileResponse.arrayBuffer()));
    } catch {
      res.status(404).end();
    }
  }
}
