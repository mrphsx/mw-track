import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Permission } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/permissions/require-permission.decorator';
import { ProjectsService } from '../projects/projects.service';
import { LandingsService } from './landings.service';
import { LandingRendererService } from './landing-renderer.service';
import { UpdateLandingDto } from './dto/update-landing.dto';

const MAX_ZIP_SIZE = 50 * 1024 * 1024;
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

@Controller('landings')
export class LandingsController {
  constructor(
    private landingsService: LandingsService,
    private rendererService: LandingRendererService,
    private projectsService: ProjectsService,
  ) {}

  // Buyer/Operator видят только лендинги проектов, к которым у них есть ProjectAccess —
  // остальные роуты ниже трогают лендинг по его id напрямую, поэтому проверяем через его
  // projectId (см. LandingsService.findOne, единственный, который отдаёт projectId).
  private async assertAccess(id: string, companyId: string, user: AuthUser): Promise<void> {
    const landing = await this.landingsService.findOne(id, companyId);
    await this.projectsService.assertAccess(landing.projectId, companyId, user.userId, user.role);
  }

  @Get('templates')
  getTemplates() {
    return this.landingsService.getTemplates();
  }

  // Мини-превью шаблона со статичными демо-данными для галереи в диалоге создания лендинга
  // (запрос пользователя 2026-07-15) — должен идти раньше ':id' ниже, иначе Nest принял бы
  // 'templates' за id лендинга.
  @Get('templates/:id/preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  templatePreview(@Param('id') id: string) {
    return this.rendererService.renderTemplateGalleryPreview(id);
  }

  // Отдельная страница /landings (все лендинги компании сразу, не только внутри одного
  // проекта) — эндпоинт объявлен раньше ':id', чтобы Nest не пытался матчить пустой path
  // как параметр.
  @Get()
  @RequirePermission(Permission.LANDINGS_VIEW)
  findAllForCompany(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.landingsService.findAllForCompany(companyId, user.userId, user.role);
  }

  @Get(':id')
  @RequirePermission(Permission.LANDINGS_VIEW)
  async findOne(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user);
    return this.landingsService.findOne(id, companyId);
  }

  @Patch(':id')
  @RequirePermission(Permission.LANDINGS_EDIT)
  async update(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateLandingDto) {
    await this.assertAccess(id, companyId, user);
    return this.landingsService.update(id, companyId, dto);
  }

  @Post(':id/publish')
  @RequirePermission(Permission.LANDINGS_EDIT)
  async publish(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user);
    return this.landingsService.publish(id, companyId);
  }

  @Post(':id/unpublish')
  @RequirePermission(Permission.LANDINGS_EDIT)
  async unpublish(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user);
    return this.landingsService.unpublish(id, companyId);
  }

  @Get(':id/preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  preview(@Param('id') id: string, @Company() companyId: string) {
    return this.rendererService.renderPreviewHtml(id, companyId);
  }

  @Get(':id/stats')
  @RequirePermission(Permission.LANDINGS_VIEW)
  async stats(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user);
    return this.landingsService.getStats(id, companyId);
  }

  @Post(':id/upload')
  @RequirePermission(Permission.LANDINGS_EDIT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ZIP_SIZE } }))
  async upload(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.assertAccess(id, companyId, user);
    return this.landingsService.uploadCustomLanding(id, companyId, file);
  }

  @Delete(':id')
  @RequirePermission(Permission.LANDINGS_DELETE)
  async remove(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user);
    return this.landingsService.remove(id, companyId);
  }

  @Post(':id/avatar')
  @RequirePermission(Permission.LANDINGS_EDIT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_SIZE } }))
  async uploadAvatar(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.assertAccess(id, companyId, user);
    return this.landingsService.uploadAvatar(id, companyId, file);
  }

  @Delete(':id/avatar')
  @RequirePermission(Permission.LANDINGS_EDIT)
  async removeAvatar(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user);
    return this.landingsService.removeAvatar(id, companyId);
  }

  // Публичный — та же картинка, что видит на публичном лендинге любой посетитель
  // (или, в дефолте, любой подписчик канала), плюс используется дашбордом для превью.
  @Public()
  @Get(':id/avatar')
  avatar(@Param('id') id: string, @Res() res: Response) {
    return this.landingsService.streamAvatar(id, res);
  }
}
