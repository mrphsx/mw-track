import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { PersonalBroadcastsService } from './personal-broadcasts.service';
import { CreatePersonalBroadcastDto } from './dto/create-personal-broadcast.dto';
import { PersonalBroadcastFilterDto } from './dto/personal-broadcast-filter.dto';

// Рассылка с личного MTProto-аккаунта (запрос пользователя 2026-08-06) — параллельная Push'у
// фича, project-scoped как и PushesController (не company-wide — в отличие от рассылок через
// бота, здесь нет прецедента "выбрать несколько проектов": личный аккаунт — одна конкретная
// живая Telegram-личность на один проект, кросс-проектный фан-аут не имеет смысла).
@Controller('projects/:projectId/personal-broadcasts')
export class PersonalBroadcastsController {
  constructor(
    private personalBroadcasts: PersonalBroadcastsService,
    private projectsService: ProjectsService,
  ) {}

  @Get('folders')
  async getFolders(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PERSONAL_BROADCASTS_VIEW]);
    return this.personalBroadcasts.getFolders(projectId);
  }

  @Post('preview-audience')
  async previewAudience(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() filter: PersonalBroadcastFilterDto,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PERSONAL_BROADCASTS_VIEW]);
    const audienceTotal = await this.personalBroadcasts.previewAudience(projectId, filter);
    return { audienceTotal };
  }

  @Post()
  async create(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePersonalBroadcastDto,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PERSONAL_BROADCASTS_CREATE]);
    return this.personalBroadcasts.create(projectId, dto, user.userId);
  }

  @Get()
  async findAll(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PERSONAL_BROADCASTS_VIEW]);
    return this.personalBroadcasts.findAll(projectId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PERSONAL_BROADCASTS_VIEW]);
    return this.personalBroadcasts.findOne(id, projectId);
  }

  @Get(':id/logs')
  async findLogs(@Param('id') id: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PERSONAL_BROADCASTS_VIEW]);
    return this.personalBroadcasts.findLogs(id, projectId);
  }

  @Post(':id/send')
  async send(@Param('id') id: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PERSONAL_BROADCASTS_SEND]);
    await this.personalBroadcasts.findOne(id, projectId); // 404 если не в этом проекте
    await this.personalBroadcasts.send(id);
    return { success: true };
  }

  @Delete(':id')
  async cancel(@Param('id') id: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.PERSONAL_BROADCASTS_DELETE]);
    await this.personalBroadcasts.cancel(id, projectId);
  }
}
