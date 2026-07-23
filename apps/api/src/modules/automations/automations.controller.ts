import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/permissions/require-permission.decorator';
import { ProjectsService } from '../projects/projects.service';
import { AutomationsService } from './automations.service';
import { CreateAutomationFlowDto, UpdateAutomationFlowDto } from './dto/automation-flow.dto';
import { CreateAutomationStepDto, MoveAutomationStepDto, UpdateAutomationStepDto } from './dto/automation-step.dto';

@Controller('projects/:projectId/automations')
export class AutomationsController {
  constructor(
    private automationsService: AutomationsService,
    private moduleRef: ModuleRef,
  ) {}

  // ProjectsService резолвится лениво через ModuleRef, а не конструкторной инъекцией — тот же
  // приём, что уже применён в AudienceService/PurchasesService: AutomationsModule статически
  // импортируя ProjectsModule ронял бут циклическим require() на уровне файлов (ChannelsModule
  // импортирует TrackingModule, тот теперь импортирует AutomationsModule, который импортировал
  // бы ProjectsModule -> ChannelsModule обратно — см. живой инцидент 2026-07-15 при первом
  // деплое этой фичи, `Scope [AppModule -> ProjectsModule -> ChannelsModule]`, "module at index
  // [0] is of type undefined"). ModuleRef.get(..., {strict:false}) достаёт уже поднятый
  // инстанс, минуя граф конструкторной инъекции целиком.
  private getProjectsService(): ProjectsService {
    return this.moduleRef.get(ProjectsService, { strict: false });
  }

  @Get()
  @RequirePermission(Permission.AUTOMATIONS_VIEW)
  async findAll(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.getProjectsService().assertAccess(projectId, companyId, user.userId, user.role);
    return this.automationsService.findAllForProject(projectId);
  }

  @Post()
  @RequirePermission(Permission.AUTOMATIONS_CREATE)
  async create(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAutomationFlowDto,
  ) {
    await this.getProjectsService().assertAccess(projectId, companyId, user.userId, user.role);
    return this.automationsService.create(projectId, companyId, dto);
  }

  @Get(':flowId')
  @RequirePermission(Permission.AUTOMATIONS_VIEW)
  async findOne(@Param('flowId') flowId: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.getProjectsService().assertAccess(projectId, companyId, user.userId, user.role);
    return this.automationsService.findOne(flowId, projectId);
  }

  @Patch(':flowId')
  @RequirePermission(Permission.AUTOMATIONS_EDIT)
  async update(
    @Param('flowId') flowId: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAutomationFlowDto,
  ) {
    await this.getProjectsService().assertAccess(projectId, companyId, user.userId, user.role);
    return this.automationsService.update(flowId, projectId, dto);
  }

  @Delete(':flowId')
  @RequirePermission(Permission.AUTOMATIONS_DELETE)
  async remove(@Param('flowId') flowId: string, @Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.getProjectsService().assertAccess(projectId, companyId, user.userId, user.role);
    return this.automationsService.remove(flowId, projectId);
  }

  @Get(':flowId/enrollments')
  @RequirePermission(Permission.AUTOMATIONS_VIEW)
  async getEnrollments(
    @Param('flowId') flowId: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.getProjectsService().assertAccess(projectId, companyId, user.userId, user.role);
    return this.automationsService.getEnrollments(flowId, projectId);
  }

  @Post(':flowId/steps')
  @RequirePermission(Permission.AUTOMATIONS_EDIT)
  async addStep(
    @Param('flowId') flowId: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAutomationStepDto,
  ) {
    await this.getProjectsService().assertAccess(projectId, companyId, user.userId, user.role);
    return this.automationsService.addStep(flowId, projectId, dto);
  }

  @Patch(':flowId/steps/:stepId')
  @RequirePermission(Permission.AUTOMATIONS_EDIT)
  async updateStep(
    @Param('flowId') flowId: string,
    @Param('stepId') stepId: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAutomationStepDto,
  ) {
    await this.getProjectsService().assertAccess(projectId, companyId, user.userId, user.role);
    return this.automationsService.updateStep(flowId, stepId, projectId, dto);
  }

  @Post(':flowId/steps/:stepId/move')
  @RequirePermission(Permission.AUTOMATIONS_EDIT)
  async moveStep(
    @Param('flowId') flowId: string,
    @Param('stepId') stepId: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: MoveAutomationStepDto,
  ) {
    await this.getProjectsService().assertAccess(projectId, companyId, user.userId, user.role);
    return this.automationsService.moveStep(flowId, stepId, projectId, dto.direction);
  }

  @Delete(':flowId/steps/:stepId')
  @RequirePermission(Permission.AUTOMATIONS_EDIT)
  async removeStep(
    @Param('flowId') flowId: string,
    @Param('stepId') stepId: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.getProjectsService().assertAccess(projectId, companyId, user.userId, user.role);
    return this.automationsService.removeStep(flowId, stepId, projectId);
  }
}
