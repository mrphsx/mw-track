import { Body, Controller, ForbiddenException, Get, Post, Query } from '@nestjs/common';
import { Permission, PushStatus } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { PushesService } from './pushes.service';
import { CreateMultiPushDto } from './dto/create-multi-push.dto';
import { PreviewAudienceDto } from './dto/preview-audience.dto';

// Календарь рассылок по всей компании сразу (запрос пользователя 2026-07-19, "так же можно и
// глобальный календарь такой под все проекты") — без @Roles(), видимость сама ограничена
// набором доступных проектов, теперь ещё и по конкретному PUSHES_VIEW-праву на каждом
// (getAccessibleProjectIds(..., Permission.PUSHES_VIEW), запрос пользователя 2026-07-28).
//
// 2026-08-04 (редизайн рассылок в единую страницу): этот же company-wide контроллер получил
// список всех пушей компании (страница "Рассылки" вместо "Календарь рассылок") и мульти-
// проектное создание/предпросмотр аудитории — та же логика видимости/прав, что и у
// scheduled-summary/scheduled-day выше, никакого нового способа авторизации.
@Controller('pushes')
export class PushesCalendarController {
  constructor(
    private pushesService: PushesService,
    private projectsService: ProjectsService,
  ) {}

  @Get('scheduled-summary')
  async scheduledSummary(@Company() companyId: string, @CurrentUser() user: AuthUser, @Query('month') month: string) {
    const projectIds = await this.projectsService.getAccessibleProjectIds(companyId, user.userId, user.role, Permission.PUSHES_VIEW);
    return this.pushesService.getGlobalScheduledSummary(projectIds, month);
  }

  @Get('scheduled-day')
  async scheduledDay(@Company() companyId: string, @CurrentUser() user: AuthUser, @Query('date') date: string) {
    const projectIds = await this.projectsService.getAccessibleProjectIds(companyId, user.userId, user.role, Permission.PUSHES_VIEW);
    return this.pushesService.getScheduledForDay(projectIds, date);
  }

  // Подробный список всех рассылок компании — под календарём на странице "Рассылки" (запрос
  // пользователя 2026-08-04). Объявлен раньше несуществующего здесь ':id' незачем — в этом
  // контроллере нет одиночного GET по id (он остаётся только в PushesController, проектном).
  // scope=pending (дефолт) / history — см. комментарий у PushesService.findAllForCompany.
  @Get()
  async findAllForCompany(
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('scope') scope?: string,
    @Query('projectId') projectId?: string,
    @Query('createdBy') createdBy?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
  ) {
    const projectIds = await this.projectsService.getAccessibleProjectIds(companyId, user.userId, user.role, Permission.PUSHES_VIEW);
    const day = (v?: string, shift = 0) => {
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
      const d = new Date(`${v}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + shift);
      return d;
    };
    const statuses = (status ?? '').split(',').filter((s): s is PushStatus => (Object.values(PushStatus) as string[]).includes(s));
    return this.pushesService.findAllForCompany(projectIds, scope === 'history' ? 'history' : scope === 'all' ? 'all' : 'pending', {
      projectId: projectId || undefined,
      createdById: createdBy || undefined,
      status: statuses,
      from: day(from),
      to: day(to, 1),
      q: q?.trim().slice(0, 100) || undefined,
    });
  }

  // Варианты фильтра «Создал» (2026-10-26).
  @Get('creators')
  async creators(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    const projectIds = await this.projectsService.getAccessibleProjectIds(companyId, user.userId, user.role, Permission.PUSHES_VIEW);
    return this.pushesService.creators(projectIds);
  }

  // Предпросмотр аудитории без создания черновика (запрос пользователя 2026-08-04, единая
  // страница создания рассылки) — projectIds без доступа/права молча отбрасываются, а не 403:
  // это превью, а не создание, пользователь мог просто ещё не закончить отмечать проекты.
  @Post('preview-audience')
  async previewAudience(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() body: PreviewAudienceDto) {
    const allowedIds = await this.projectsService.getAccessibleProjectIds(companyId, user.userId, user.role, Permission.PUSHES_CREATE);
    const projectIds = body.projectIds.filter((id) => allowedIds.includes(id));
    return this.pushesService.previewAudienceForProjects(projectIds, body.filter);
  }

  // Мульти-проектное создание (запрос пользователя 2026-08-04: "можно будет выбрать один или
  // несколько проектов для рассылки") — здесь, в отличие от превью выше, недоступный projectId
  // — явная ошибка (403), не молчаливый пропуск: на создании это должно быть заметно, а не
  // тихо создать рассылку в меньшем числе проектов, чем выбрал пользователь.
  @Post()
  async createMulti(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateMultiPushDto) {
    const allowedIds = await this.projectsService.getAccessibleProjectIds(companyId, user.userId, user.role, Permission.PUSHES_CREATE);
    const invalid = dto.projectIds.filter((id) => !allowedIds.includes(id));
    if (invalid.length) throw new ForbiddenException('Нет доступа к выбранным проектам');
    return this.pushesService.createForProjects(dto.projectIds, dto, dto.sendNow, companyId, user.userId);
  }
}
