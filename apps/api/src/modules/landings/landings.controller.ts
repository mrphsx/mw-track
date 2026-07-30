import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Permission } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { PermissionsService } from '../../common/permissions/permissions.service';
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
    private permissionsService: PermissionsService,
  ) {}

  // Buyer/Operator видят только лендинги проектов, к которым у них есть ProjectAccess —
  // остальные роуты ниже трогают лендинг по его id напрямую, поэтому проверяем через его
  // projectId (см. LandingsService.findOne, единственный, который отдаёт projectId).
  private async assertAccess(id: string, companyId: string, user: AuthUser, requiredPermissions?: Permission[]): Promise<void> {
    const landing = await this.landingsService.findOne(id, companyId);
    await this.projectsService.assertAccess(landing.projectId, companyId, user.userId, user.role, requiredPermissions);
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
  // как параметр. Разрешение здесь не привязано к конкретному проекту (список company-wide) —
  // проверяем "есть ли LANDINGS_VIEW хотя бы на одном проекте", реальная фильтрация по
  // конкретным проектам — внутри LandingsService.findAllForCompany.
  @Get()
  async findAllForCompany(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.permissionsService.assertAnyProjectPermission(user.userId, user.role, Permission.LANDINGS_VIEW);
    return this.landingsService.findAllForCompany(companyId, user.userId, user.role);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_VIEW]);
    return this.landingsService.findOne(id, companyId);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateLandingDto) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_EDIT]);
    return this.landingsService.update(id, companyId, dto);
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_EDIT]);
    return this.landingsService.publish(id, companyId);
  }

  @Post(':id/unpublish')
  async unpublish(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_EDIT]);
    return this.landingsService.unpublish(id, companyId);
  }

  // Багфикс 2026-07-28 (аудит разрешений сотрудников): раньше ни @RequirePermission, ни
  // assertAccess вообще — любой сотрудник компании мог посмотреть превью ЛЮБОГО лендинга
  // компании, зная его id, независимо от ProjectAccess к конкретному проекту.
  @Get(':id/preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async preview(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_VIEW]);
    return this.rendererService.renderPreviewHtml(id, companyId);
  }

  @Get(':id/stats')
  async stats(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_VIEW]);
    return this.landingsService.getStats(id, companyId);
  }

  @Post(':id/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ZIP_SIZE } }))
  async upload(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_EDIT]);
    return this.landingsService.uploadCustomLanding(id, companyId, file);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_DELETE]);
    return this.landingsService.remove(id, companyId);
  }

  @Post(':id/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_SIZE } }))
  async uploadAvatar(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_EDIT]);
    return this.landingsService.uploadAvatar(id, companyId, file);
  }

  @Delete(':id/avatar')
  async removeAvatar(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_EDIT]);
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
