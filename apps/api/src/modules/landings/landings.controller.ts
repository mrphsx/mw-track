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
import { UploadPrelandingHtmlDto } from './dto/upload-prelanding-html.dto';

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
  // allowArchived:true (запрос пользователя 2026-08-02: "лэндинги удалённого проекта не могу
  // удалить, 404 Проект не найден") — архивация проекта не должна превращать его лендинги в
  // навсегда неудаляемые: просмотр/редактирование/удаление лендинга архивированного проекта
  // теперь работает так же, как и активного, единственное отличие — сам проект уже не в
  // основных списках.
  private async assertAccess(id: string, companyId: string, user: AuthUser, requiredPermissions?: Permission[]): Promise<void> {
    const landing = await this.landingsService.findOne(id, companyId);
    await this.projectsService.assertAccess(landing.projectId, companyId, user.userId, user.role, requiredPermissions, { allowArchived: true });
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

  // Отдаёт один файл CUSTOM-лендинга (картинку/css/js) с той же проверкой доступа, что и сам
  // /preview выше — используется фронтендом (previewLanding в lib/landings.ts) для подмены
  // относительных ссылок внутри превью-HTML на прямые blob-URL, см. комментарий у
  // streamPreviewAsset в LandingRendererService.
  @Get(':id/preview-asset/*')
  async previewAsset(
    @Param('id') id: string,
    @Param('0') subPath: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_VIEW]);
    await this.rendererService.streamPreviewAsset(id, companyId, subPath, res);
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

  // Белая страница для клоакинга типа PRELANDING (запрос пользователя 2026-09-23). Всегда 200 —
  // успех/отказ кодируются в теле {accepted, checks}, а не в HTTP-статусе: HttpExceptionFilter
  // прокидывает наружу только message, молча отбрасывая любые другие поля исключения (напр.
  // checks), это сломало бы фронтовый ReviewChecklist. Тот же приём, что уже использует
  // uploadCustomLanding/processAndReviewZip выше.
  @Post(':id/cloaking/prelanding')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ZIP_SIZE } }))
  async uploadCloakingPrelanding(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_EDIT]);
    return this.landingsService.uploadCloakingPrelanding(id, companyId, file);
  }

  @Delete(':id/cloaking/prelanding')
  async removeCloakingPrelanding(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_EDIT]);
    return this.landingsService.removeCloakingPrelanding(id, companyId);
  }

  // Альтернатива ZIP для white page (запрос пользователя 2026-09-23) — обычный JSON body, не
  // multipart. Тот же 200-всегда-с-{accepted,checks} приём, что и у ZIP-варианта выше.
  @Post(':id/cloaking/prelanding/html')
  async uploadCloakingPrelandingHtml(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadPrelandingHtmlDto,
  ) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_EDIT]);
    return this.landingsService.uploadCloakingPrelandingHtml(id, companyId, dto.html);
  }

  @Post(':id/verify-connection')
  async verifyConnection(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_EDIT]);
    return this.landingsService.verifyExternalLanding(id, companyId);
  }

  @Get(':id/external-snippet')
  async externalSnippet(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_VIEW]);
    return this.landingsService.getExternalLandingSnippet(id, companyId);
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
