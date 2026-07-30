import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { BotScenariosService } from './bot-scenarios.service';
import { ChannelsService } from './channels.service';
import { CreateBotScenarioDto, UpdateBotScenarioDto } from './dto/bot-scenario.dto';
import { CreateScenarioElementDto, MoveScenarioElementDto, UpdateScenarioElementDto } from './dto/bot-scenario-element.dto';
import { ScenarioStatsQueryDto } from './dto/bot-scenario-stats.dto';
import { UpdateScenarioAbTestWeightsDto } from './dto/scenario-ab-test.dto';

@Controller('channels/:channelId/scenarios')
export class BotScenariosController {
  constructor(
    private botScenariosService: BotScenariosService,
    private channelsService: ChannelsService,
    private moduleRef: ModuleRef,
  ) {}

  // ModuleRef — тот же паттерн, что и в ChannelsController (см. комментарий там):
  // ChannelsModule не импортирует ProjectsModule напрямую.
  private getProjectsService(): ProjectsService {
    return this.moduleRef.get(ProjectsService, { strict: false });
  }

  private async assertChannelAccess(channelId: string, companyId: string, user: AuthUser, requiredPermissions?: Permission[]): Promise<void> {
    const channel = await this.channelsService.findOne(channelId, companyId);
    await this.getProjectsService().assertAccess(channel.projectId, companyId, user.userId, user.role, requiredPermissions);
  }

  private async assertScenarioAccess(id: string, companyId: string, user: AuthUser, requiredPermissions?: Permission[]): Promise<void> {
    const scenario = await this.botScenariosService.findOne(id, companyId);
    await this.assertChannelAccess(scenario.channelId, companyId, user, requiredPermissions);
  }

  @Get()
  async findAll(@Param('channelId') channelId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertChannelAccess(channelId, companyId, user, [Permission.CHANNEL_VIEW]);
    return this.botScenariosService.findAll(channelId, companyId);
  }

  @Post()
  async create(
    @Param('channelId') channelId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateBotScenarioDto,
  ) {
    await this.assertChannelAccess(channelId, companyId, user, [Permission.CHANNEL_MANAGE]);
    return this.botScenariosService.create(channelId, companyId, dto);
  }

  // Перед ':id' — иначе Nest принял бы "ab-test-groups" за id сценария (маршруты матчатся по
  // порядку объявления в контроллере).
  @Get('ab-test-groups')
  async listAbTestGroups(@Param('channelId') channelId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertChannelAccess(channelId, companyId, user, [Permission.CHANNEL_VIEW]);
    return this.botScenariosService.listAbTestGroups(channelId, companyId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertScenarioAccess(id, companyId, user, [Permission.CHANNEL_VIEW]);
    return this.botScenariosService.findOneWithElements(id, companyId);
  }

  @Get(':id/stats')
  async getStats(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query() query: ScenarioStatsQueryDto) {
    await this.assertScenarioAccess(id, companyId, user, [Permission.CHANNEL_VIEW]);
    return this.botScenariosService.getStats(id, companyId, query);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateBotScenarioDto) {
    await this.assertScenarioAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    return this.botScenariosService.update(id, companyId, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertScenarioAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    return this.botScenariosService.remove(id, companyId);
  }

  @Post(':id/elements')
  async addElement(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateScenarioElementDto,
  ) {
    await this.assertScenarioAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    return this.botScenariosService.addElement(id, companyId, dto);
  }

  @Patch(':id/elements/:elementId')
  async updateElement(
    @Param('id') id: string,
    @Param('elementId') elementId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateScenarioElementDto,
  ) {
    await this.assertScenarioAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    return this.botScenariosService.updateElement(id, elementId, companyId, dto);
  }

  @Post(':id/elements/:elementId/move')
  async moveElement(
    @Param('id') id: string,
    @Param('elementId') elementId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: MoveScenarioElementDto,
  ) {
    await this.assertScenarioAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    return this.botScenariosService.moveElement(id, elementId, companyId, dto.direction);
  }

  @Delete(':id/elements/:elementId')
  async removeElement(@Param('id') id: string, @Param('elementId') elementId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertScenarioAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    return this.botScenariosService.removeElement(id, elementId, companyId);
  }

  // --- A/B-тест (запрос пользователя 2026-07-25) — :id здесь может быть ЛЮБОЙ сценарий группы
  // (основной или вариант), сервис резолвит группу через его abTestGroupId. ---

  @Post(':id/ab-test/variant')
  async addAbTestVariant(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertScenarioAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    return this.botScenariosService.addAbTestVariant(id, companyId);
  }

  @Patch(':id/ab-test/weights')
  async updateAbTestWeights(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateScenarioAbTestWeightsDto,
  ) {
    await this.assertScenarioAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    return this.botScenariosService.updateAbTestWeights(id, companyId, dto);
  }

  @Post(':id/ab-test/end')
  async endAbTest(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertScenarioAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    return this.botScenariosService.endAbTest(id, companyId);
  }

  @Get(':id/ab-test/stats')
  async getAbTestStats(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertScenarioAccess(id, companyId, user, [Permission.CHANNEL_VIEW]);
    return this.botScenariosService.getAbTestStats(id, companyId);
  }
}
