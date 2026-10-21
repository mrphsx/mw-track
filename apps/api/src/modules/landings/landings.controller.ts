import { BadRequestException, Body, Controller, ForbiddenException, Delete, Get, Header, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Permission } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { ProjectsService } from '../projects/projects.service';
import { LandingAction, LandingsService } from './landings.service';
import { LandingRendererService } from './landing-renderer.service';
import { UpdateLandingDto } from './dto/update-landing.dto';
import { UploadPrelandingHtmlDto } from './dto/upload-prelanding-html.dto';
import { CreateCloakingRuleDto, ReorderCloakingRulesDto, UpdateCloakingRuleDto } from './dto/cloaking-rule.dto';
import { CloakingLogsQueryDto } from './dto/cloaking-logs-query.dto';
import { BuilderPreviewDto } from './dto/builder-config.dto';
import { BUILDER_TEMPLATE_ID, resolveBuilderConfig } from './builder.util';

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
    try {
      await this.projectsService.assertAccess(landing.projectId, companyId, user.userId, user.role, requiredPermissions, { allowArchived: true });
    } catch (error) {
      // Просмотр одного лендинга: кто по области прав может его изменять или удалять (см.
      // assertAction ниже), тот может его и открыть — иначе "изменение своих" было бы правом,
      // которым нельзя воспользоваться.
      if (!(error instanceof ForbiddenException)) throw error;
      const ctx = await this.landingsService.resolveActionContext(user.userId, user.role);
      if (!this.landingsService.canPerform('edit', landing, ctx) && !this.landingsService.canPerform('delete', landing, ctx)) throw error;
    }
  }

  // Изменение и удаление (запрос пользователя 2026-10-13: "3 категории — все лендинги, свои,
  // лендинги доступных проектов, и под каждую настроить может удалять или нет"). Право даёт
  // либо per-project LANDINGS_EDIT/LANDINGS_DELETE, либо общая область сотрудника
  // (User.landingsEditScope/landingsDeleteScope) — вся логика в LandingsService.canPerform.
  // findOne ищет по companyId, так что чужая компания по-прежнему получает 404.
  private async assertAction(id: string, companyId: string, user: AuthUser, action: LandingAction): Promise<void> {
    const landing = await this.landingsService.findOne(id, companyId);
    const ctx = await this.landingsService.resolveActionContext(user.userId, user.role);
    if (!this.landingsService.canPerform(action, landing, ctx)) {
      throw new ForbiddenException(action === 'delete' ? 'Нет права удалять этот лендинг' : 'Нет права изменять этот лендинг');
    }
  }

  @Get('templates')
  getTemplates(@Company() companyId: string) {
    return this.landingsService.getTemplates(companyId);
  }

  // Мини-превью шаблона со статичными демо-данными для галереи в диалоге создания лендинга
  // (запрос пользователя 2026-07-15) — должен идти раньше ':id' ниже, иначе Nest принял бы
  // 'templates' за id лендинга. assertTemplateAllowed — компания без доступа к
  // restrictedToCompanyIds-шаблону не может получить его превью, даже зная templateId напрямую
  // (тот же рубеж, что и на создание).
  @Get('templates/:id/preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  templatePreview(@Param('id') id: string, @Company() companyId: string) {
    this.landingsService.assertTemplateAllowed(id, companyId);
    return this.rendererService.renderTemplateGalleryPreview(id);
  }

  // Живое превью конструктора (2026-10-20) — несохранённый конфиг из редактора. Объявлено раньше
  // ':id', чтобы 'builder' не приняли за id лендинга. Ничего не читает из базы, поэтому без
  // проверки проекта; достаточно быть сотрудником компании.
  @Post('builder/preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  builderPreview(@Body() dto: BuilderPreviewDto) {
    return this.rendererService.renderBuilderPreview(dto);
  }

  // Отдельная страница /landings (все лендинги компании сразу, не только внутри одного
  // проекта) — эндпоинт объявлен раньше ':id', чтобы Nest не пытался матчить пустой path
  // как параметр. Разрешение здесь не привязано к конкретному проекту (список company-wide) —
  // проверяем "есть ли LANDINGS_VIEW хотя бы на одном проекте", реальная фильтрация по
  // конкретным проектам — внутри LandingsService.findAllForCompany.
  @Get()
  async findAllForCompany(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.permissionsService.assertAnyProjectPermission(user.userId, user.role, Permission.LANDINGS_VIEW);
    const landings = await this.landingsService.findAllForCompany(companyId, user.userId, user.role);
    return this.landingsService.withActionFlags(landings, user.userId, user.role);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_VIEW]);
    const landing = await this.landingsService.findOne(id, companyId);
    const [withFlags] = await this.landingsService.withActionFlags([landing], user.userId, user.role);
    // Конструктор: редактор получает конфиг уже в текущем формате (старые лендинги первой версии
    // переводятся на лету, в базе ничего не меняется до первого сохранения).
    if (withFlags.templateId === BUILDER_TEMPLATE_ID) {
      return { ...withFlags, builderConfig: resolveBuilderConfig(withFlags.builderConfig) };
    }
    return withFlags;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateLandingDto) {
    await this.assertAction(id, companyId, user, 'edit');
    return this.landingsService.update(id, companyId, dto);
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAction(id, companyId, user, 'edit');
    return this.landingsService.publish(id, companyId);
  }

  @Post(':id/unpublish')
  async unpublish(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAction(id, companyId, user, 'edit');
    return this.landingsService.unpublish(id, companyId);
  }

  // Копия лендинга (запрос клиентов 2026-10-02: "чтоб просто домен заменить для следующей
  // ссылки") — та же LANDINGS_EDIT-проверка на исходный лендинг, что и у остальных мутирующих
  // :id-роутов выше; копия остаётся в том же проекте, что и оригинал.
  @Post(':id/duplicate')
  async duplicate(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAction(id, companyId, user, 'edit');
    return this.landingsService.duplicate(id, companyId, user.userId);
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
    await this.assertAction(id, companyId, user, 'edit');
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
    await this.assertAction(id, companyId, user, 'edit');
    return this.landingsService.uploadCloakingPrelanding(id, companyId, file);
  }

  @Delete(':id/cloaking/prelanding')
  async removeCloakingPrelanding(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAction(id, companyId, user, 'edit');
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
    await this.assertAction(id, companyId, user, 'edit');
    return this.landingsService.uploadCloakingPrelandingHtml(id, companyId, dto.html);
  }

  // Просмотр/скачивание уже загруженной белой страницы (запрос пользователя 2026-09-25) — те же
  // 4 маршрута, что уже есть для основного контента лендинга (preview/preview-asset), просто
  // указывают на cloakingPrelandingBasePath вместо customBasePath, плюс два новых для скачивания.
  @Get(':id/cloaking/prelanding/preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async previewCloakingPrelanding(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_VIEW]);
    return this.landingsService.renderCloakingPrelandingPreviewHtml(id, companyId);
  }

  @Get(':id/cloaking/prelanding/preview-asset/*')
  async previewCloakingPrelandingAsset(
    @Param('id') id: string,
    @Param('0') subPath: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_VIEW]);
    await this.landingsService.streamCloakingPrelandingAsset(id, companyId, subPath, res);
  }

  @Get(':id/cloaking/prelanding/download-html')
  async downloadCloakingPrelandingHtml(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_VIEW]);
    await this.landingsService.streamCloakingPrelandingHtmlDownload(id, companyId, res);
  }

  @Get(':id/cloaking/prelanding/download-zip')
  async downloadCloakingPrelandingZip(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_VIEW]);
    await this.landingsService.streamCloakingPrelandingZipDownload(id, companyId, res);
  }

  // Движок правил клоакинга (запрос пользователя 2026-09-24) — CRUD правил одного лендинга,
  // те же LANDINGS_VIEW/LANDINGS_EDIT права, что и у остальных роутов клоакинга выше. Порядок
  // роутов: 'reorder' объявлен раньше ':ruleId', иначе Nest принял бы 'reorder' за id правила.
  @Get(':id/cloaking/rules')
  async listCloakingRules(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_VIEW]);
    return this.landingsService.listCloakingRules(id, companyId);
  }

  @Post(':id/cloaking/rules')
  async createCloakingRule(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateCloakingRuleDto) {
    await this.assertAction(id, companyId, user, 'edit');
    return this.landingsService.createCloakingRule(id, companyId, dto);
  }

  @Patch(':id/cloaking/rules/reorder')
  async reorderCloakingRules(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: ReorderCloakingRulesDto) {
    await this.assertAction(id, companyId, user, 'edit');
    await this.landingsService.reorderCloakingRules(id, companyId, dto.ruleIds);
  }

  @Patch(':id/cloaking/rules/:ruleId')
  async updateCloakingRule(
    @Param('id') id: string,
    @Param('ruleId') ruleId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateCloakingRuleDto,
  ) {
    await this.assertAction(id, companyId, user, 'edit');
    return this.landingsService.updateCloakingRule(id, companyId, ruleId, dto);
  }

  @Delete(':id/cloaking/rules/:ruleId')
  async removeCloakingRule(@Param('id') id: string, @Param('ruleId') ruleId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAction(id, companyId, user, 'edit');
    await this.landingsService.removeCloakingRule(id, companyId, ruleId);
  }

  // Журнал заблокированных заходов (запрос пользователя 2026-09-25) — LANDINGS_VIEW, как и
  // остальные read-роуты клоакинга.
  @Get(':id/cloaking/logs')
  async listCloakingLogs(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query() query: CloakingLogsQueryDto) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_VIEW]);
    return this.landingsService.listCloakingLogs(id, companyId, query);
  }

  @Post(':id/verify-connection')
  async verifyConnection(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAction(id, companyId, user, 'edit');
    return this.landingsService.verifyExternalLanding(id, companyId);
  }

  @Get(':id/external-snippet')
  async externalSnippet(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.LANDINGS_VIEW]);
    return this.landingsService.getExternalLandingSnippet(id, companyId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAction(id, companyId, user, 'delete');
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
    await this.assertAction(id, companyId, user, 'edit');
    return this.landingsService.uploadAvatar(id, companyId, file);
  }

  @Delete(':id/avatar')
  async removeAvatar(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAction(id, companyId, user, 'edit');
    return this.landingsService.removeAvatar(id, companyId);
  }

  @Post(':id/builder-background')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_SIZE } }))
  async uploadBuilderBackground(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.assertAction(id, companyId, user, 'edit');
    return this.landingsService.uploadBuilderBackground(id, companyId, file);
  }

  @Delete(':id/builder-background')
  async removeBuilderBackground(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAction(id, companyId, user, 'edit');
    return this.landingsService.removeBuilderBackground(id, companyId);
  }

  @Public()
  @Get(':id/builder-background')
  builderBackground(@Param('id') id: string, @Res() res: Response) {
    return this.landingsService.streamBuilderBackground(id, res);
  }

  // Публичный — та же картинка, что видит на публичном лендинге любой посетитель
  // (или, в дефолте, любой подписчик канала), плюс используется дашбордом для превью.
  @Public()
  @Get(':id/avatar')
  avatar(@Param('id') id: string, @Res() res: Response) {
    return this.landingsService.streamAvatar(id, res);
  }
}
