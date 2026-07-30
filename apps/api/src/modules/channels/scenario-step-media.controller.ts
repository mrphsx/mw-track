import { Body, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Permission } from '@prisma/client';
import { ModuleRef } from '@nestjs/core';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ProjectsService } from '../projects/projects.service';
import { BotScenariosService } from './bot-scenarios.service';
import { ChannelsService } from './channels.service';

const MAX_STEP_MEDIA_SIZE = 50 * 1024 * 1024;

// Отдельный контроллер (не BotScenariosController, у него префикс channels/:channelId/scenarios,
// а загрузка медиа для шага сообщения не привязана к конкретному сценарию/шагу на момент
// загрузки — тот же порядок, что уже используется формой создания пуша) — тот же
// приём разделения "авторизованная загрузка / публичная раздача", что PushMediaController.
@Controller()
export class ScenarioStepMediaController {
  constructor(
    private botScenariosService: BotScenariosService,
    private channelsService: ChannelsService,
    private moduleRef: ModuleRef,
  ) {}

  private getProjectsService(): ProjectsService {
    return this.moduleRef.get(ProjectsService, { strict: false });
  }

  @Post('channels/:channelId/scenario-step-media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_STEP_MEDIA_SIZE } }))
  async upload(
    @Param('channelId') channelId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('mediaType') mediaType?: string,
  ) {
    const channel = await this.channelsService.findOne(channelId, companyId);
    await this.getProjectsService().assertAccess(channel.projectId, companyId, user.userId, user.role, [Permission.CHANNEL_MANAGE]);
    return this.botScenariosService.uploadStepMedia(companyId, channelId, mediaType || 'photo', file);
  }

  @Public()
  @Get('scenario-step-media/:key')
  async stream(@Param('key') key: string, @Res() res: Response) {
    try {
      const { stream, contentType, size } = await this.botScenariosService.streamStepMedia(key);
      if (contentType) res.setHeader('Content-Type', contentType);
      // Content-Length + no-transform — тот же фикс, что у pushes-media (WEBPAGE_CURL_FAILED
      // для альбомов + срез заголовка Cloudflare на публичном домене, 2026-07-17).
      if (size) res.setHeader('Content-Length', String(size));
      res.setHeader('Cache-Control', 'public, max-age=86400, no-transform');
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).end();
      });
      stream.pipe(res);
    } catch {
      res.status(404).end();
    }
  }
}
