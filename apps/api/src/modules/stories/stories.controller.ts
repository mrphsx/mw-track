import { Body, Controller, Delete, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/permissions/require-permission.decorator';
import { ProjectsService } from '../projects/projects.service';
import { ChannelMediaService } from '../channels/channel-media.service';
import { StoriesService } from './stories.service';
import { CreateStoryDto } from './dto/create-story.dto';

const MAX_STORY_MEDIA_SIZE = 50 * 1024 * 1024;

// Компания целиком (лендинг модуля — какие проекты подключены/доступны) — отдельный контроллер
// без префикса projects/:projectId, в отличие от остального модуля.
@Controller('stories')
export class StoriesOverviewController {
  constructor(
    private storiesService: StoriesService,
    private projectsService: ProjectsService,
  ) {}

  @Get('overview')
  @RequirePermission(Permission.CHANNEL_VIEW)
  async overview(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.storiesService.getCompanyOverview(companyId, user.userId, user.role);
  }
}

@Controller('projects/:projectId/stories')
export class StoriesController {
  constructor(
    private storiesService: StoriesService,
    private projectsService: ProjectsService,
    private media: ChannelMediaService,
  ) {}

  @Get()
  @RequirePermission(Permission.CHANNEL_VIEW)
  async findMany(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.storiesService.findMany(projectId, Number(page) || 1, Number(limit) || 20);
  }

  @Post()
  @RequirePermission(Permission.CHANNEL_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_STORY_MEDIA_SIZE } }))
  async create(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateStoryDto,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.storiesService.create(projectId, companyId, user.userId, file, dto);
  }

  @Post(':id/retry')
  @RequirePermission(Permission.CHANNEL_MANAGE)
  async retry(@Param('projectId') projectId: string, @Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    await this.storiesService.retry(id, projectId);
    return { success: true };
  }

  @Delete(':id')
  @RequirePermission(Permission.CHANNEL_MANAGE)
  async remove(@Param('projectId') projectId: string, @Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    await this.storiesService.remove(id, projectId);
    return { success: true };
  }

  // Авторизованный, НЕ @Public() (в отличие от pushes-media) — GramJS скачивает байты сам
  // напрямую из MinIO при публикации, ему публичная ссылка не нужна вообще. Этот роут — только
  // для превью в списке историй самой CRM, поэтому нет причин делать медиа доступным по ссылке
  // без авторизации.
  @Get(':id/media')
  @RequirePermission(Permission.CHANNEL_VIEW)
  async streamMedia(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    const story = await this.storiesService.findOneForMedia(id, projectId);
    try {
      const [stream, contentType] = await Promise.all([
        this.media.getObjectStream(story.mediaKey),
        this.media.getContentType(story.mediaKey),
      ]);
      if (contentType) res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).end();
      });
      stream.pipe(res);
    } catch {
      res.status(404).end();
    }
  }
}
