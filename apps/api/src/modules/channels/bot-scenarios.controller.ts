import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Permission } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/permissions/require-permission.decorator';
import { ProjectsService } from '../projects/projects.service';
import { BotScenariosService } from './bot-scenarios.service';
import { ChannelsService } from './channels.service';
import { CreateBotScenarioDto, UpdateBotScenarioDto, UploadScenarioMediaDto } from './dto/bot-scenario.dto';

const MAX_SCENARIO_MEDIA_SIZE = 20 * 1024 * 1024;

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

  private async assertChannelAccess(channelId: string, companyId: string, user: AuthUser): Promise<void> {
    const channel = await this.channelsService.findOne(channelId, companyId);
    await this.getProjectsService().assertAccess(channel.projectId, companyId, user.userId, user.role);
  }

  private async assertScenarioAccess(id: string, companyId: string, user: AuthUser): Promise<void> {
    const scenario = await this.botScenariosService.findOne(id, companyId);
    await this.assertChannelAccess(scenario.channelId, companyId, user);
  }

  @Get()
  @RequirePermission(Permission.CHANNEL_VIEW)
  async findAll(@Param('channelId') channelId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertChannelAccess(channelId, companyId, user);
    return this.botScenariosService.findAll(channelId, companyId);
  }

  @Post()
  @RequirePermission(Permission.CHANNEL_MANAGE)
  async create(
    @Param('channelId') channelId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateBotScenarioDto,
  ) {
    await this.assertChannelAccess(channelId, companyId, user);
    return this.botScenariosService.create(channelId, companyId, dto);
  }

  @Patch(':id')
  @RequirePermission(Permission.CHANNEL_MANAGE)
  async update(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateBotScenarioDto) {
    await this.assertScenarioAccess(id, companyId, user);
    return this.botScenariosService.update(id, companyId, dto);
  }

  @Delete(':id')
  @RequirePermission(Permission.CHANNEL_MANAGE)
  async remove(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertScenarioAccess(id, companyId, user);
    return this.botScenariosService.remove(id, companyId);
  }

  @Post(':id/media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SCENARIO_MEDIA_SIZE } }))
  @RequirePermission(Permission.CHANNEL_MANAGE)
  async uploadMedia(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadScenarioMediaDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.assertScenarioAccess(id, companyId, user);
    return this.botScenariosService.uploadMedia(id, companyId, dto.mediaType, file);
  }

  @Delete(':id/media')
  @RequirePermission(Permission.CHANNEL_MANAGE)
  async removeMedia(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertScenarioAccess(id, companyId, user);
    return this.botScenariosService.removeMedia(id, companyId);
  }

  // Публичный — Telegram сам фетчит эту ссылку при отправке сообщения сценария (тот же
  // приём, что и GET /channels/:id/welcome-media).
  @Public()
  @Get(':id/media')
  media(@Param('id') id: string, @Res() res: Response) {
    return this.botScenariosService.streamMedia(id, res);
  }
}
