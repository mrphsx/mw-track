import { Body, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ProjectsService } from '../projects/projects.service';
import { PushesService } from './pushes.service';

const MAX_PUSH_MEDIA_SIZE = 50 * 1024 * 1024;

// Отдельный контроллер (не PushesController, у него префикс projects/:projectId/pushes) —
// нужны два разных пути: загрузка (авторизованная, привязана к проекту) и публичная раздача
// (без auth — её фетчит сам Telegram при реальной отправке, тот же приём, что и у
// welcome-media/scenario-media в ChannelsModule).
@Controller()
export class PushMediaController {
  constructor(
    private pushesService: PushesService,
    private projectsService: ProjectsService,
  ) {}

  @Post('projects/:projectId/pushes/media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PUSH_MEDIA_SIZE } }))
  async upload(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('mediaType') mediaType?: string,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PUSHES_CREATE]);
    return this.pushesService.uploadMedia(file, mediaType);
  }

  // Переключатель "сделать кружком" поверх уже загруженного видео (запрос пользователя
  // 2026-08-05) — единый контейнер загрузки сам определяет тип по файлу при самой загрузке
  // (видео = видео), обрезка в квадрат теперь отдельное действие ПОСЛЕ, не выбор типа заранее.
  @Post('projects/:projectId/pushes/media/:key/to-video-note')
  async toVideoNote(
    @Param('projectId') projectId: string,
    @Param('key') key: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PUSHES_CREATE]);
    return this.pushesService.convertToVideoNote(key);
  }

  @Public()
  @Get('pushes-media/:key')
  async stream(@Param('key') key: string, @Res() res: Response) {
    try {
      const { stream, contentType, size } = await this.pushesService.streamMedia(key);
      if (contentType) res.setHeader('Content-Type', contentType);
      // Без Content-Length Telegram's sendMediaGroup фетчер падает с WEBPAGE_CURL_FAILED —
      // одиночные sendPhoto/sendVideo это терпят, альбом нет (баг, 2026-07-17). Заголовок
      // корректно уходит с нашего Nest/nginx, но Cloudflare (домен на orange-cloud проксе)
      // всё равно его срезает при проксировании публичного домена, если явно не сказать ему
      // не трогать тело ответа — отсюда no-transform (стандартная HTTP-директива, которую
      // CDN обязаны уважать и не должны ни рекодировать, ни ре-чанкать ответ).
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
