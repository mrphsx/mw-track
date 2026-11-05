import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { ExtApiService } from './ext-api.service';
import { ExtEventDto, ExtEventsBatchDto } from './ext-event.dto';

// Единый API событий (2026-11-05) — публичный, авторизация секретным ключом проекта
// (X-Api-Key: sk_live_… или Authorization: Bearer sk_live_…).
@Controller('ext')
export class ExtApiController {
  constructor(private service: ExtApiService) {}

  // Проверка ключа: какой это проект.
  @Public()
  @Get('ping')
  async ping(@Headers('x-api-key') apiKey?: string, @Headers('authorization') auth?: string) {
    const project = await this.service.projectByKey(apiKey ?? auth);
    return { ok: true, project: { id: project.id, name: project.name } };
  }

  @Public()
  @Post('event')
  @HttpCode(200)
  async event(@Body() dto: ExtEventDto, @Headers('x-api-key') apiKey?: string, @Headers('authorization') auth?: string) {
    const project = await this.service.projectByKey(apiKey ?? auth);
    return this.service.processOne(project, dto);
  }

  @Public()
  @Post('events')
  @HttpCode(200)
  async events(@Body() dto: ExtEventsBatchDto, @Headers('x-api-key') apiKey?: string, @Headers('authorization') auth?: string) {
    const project = await this.service.projectByKey(apiKey ?? auth);
    return { results: await this.service.processBatch(project, dto.events) };
  }
}

// Журнал запросов API — для сотрудников в настройках проекта.
@Controller('projects/:projectId/ext-api')
export class ExtApiLogsController {
  constructor(
    private service: ExtApiService,
    private projects: ProjectsService,
  ) {}

  @Get('logs')
  async logs(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projects.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CHANNEL_MANAGE]);
    return this.service.logs(projectId);
  }
}
