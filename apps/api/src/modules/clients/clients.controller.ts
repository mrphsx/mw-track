import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { StatsPeriodDto } from '../../common/dto/stats-period.dto';
import { PermissionsService } from '../../common/permissions/permissions.service';
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
  ) {}

  @Get()
  async findMany(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query() filters: ClientFiltersDto) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CLIENTS_VIEW]);
    return this.clientsService.findMany(projectId, filters);
  }

  @Get('stats')
  async stats(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query() period: StatsPeriodDto,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.STATS_VIEW]);
    const stats = await this.clientsRepository.getProjectStats(projectId, period);

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
    return this.clientsRepository.getConversionFunnel(projectId, period);
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
    const csv = await this.clientsService.exportForLookalike(projectId, onlyBuyers !== 'false');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="lookalike_${projectId}.csv"`);
    res.send(csv);
  }

  @Get(':clientId')
  async findOne(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CLIENTS_VIEW]);
    return this.clientsService.getClientDetail(clientId, companyId);
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
