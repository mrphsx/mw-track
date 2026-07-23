import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/permissions/require-permission.decorator';
import { ProjectsService } from '../projects/projects.service';
import { LandingsService } from './landings.service';
import { UpsertAbTestGroupDto } from './dto/ab-test-group.dto';

// Один контроллер с явными полными путями вместо разбивки на два класса с разными базовыми
// префиксами (как LandingsController/ProjectLandingsController) — группа A/B-теста не 1:1 с
// одним лендингом, поэтому создание живёт под /projects/:projectId/, а изменение/остановка —
// под собственным /ab-test-groups/:groupId, без общего префикса класса.
@Controller()
export class AbTestGroupsController {
  constructor(
    private landingsService: LandingsService,
    private projectsService: ProjectsService,
  ) {}

  // Список активных тестов проекта (запрос пользователя 2026-07-17: "где мне нормально увидеть
  // эту группу, сложно ориентироваться чтобы взять именно под эту группу ссылку") — раньше
  // группа была видна только косвенно, бейджем на карточке участника.
  @Get('projects/:projectId/ab-test-groups')
  @RequirePermission(Permission.AB_TESTS_VIEW)
  async findAll(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.landingsService.listAbTestGroups(projectId);
  }

  @Post('projects/:projectId/ab-test-groups')
  @RequirePermission(Permission.AB_TESTS_CREATE)
  async create(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertAbTestGroupDto,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.landingsService.createAbTestGroup(projectId, companyId, dto);
  }

  @Patch('ab-test-groups/:groupId')
  @RequirePermission(Permission.AB_TESTS_EDIT)
  async update(
    @Param('groupId') groupId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertAbTestGroupDto,
  ) {
    const projectId = await this.landingsService.getAbTestGroupProjectId(groupId);
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.landingsService.updateAbTestGroup(groupId, dto);
  }

  @Delete('ab-test-groups/:groupId')
  @RequirePermission(Permission.AB_TESTS_EDIT)
  async remove(@Param('groupId') groupId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    const projectId = await this.landingsService.getAbTestGroupProjectId(groupId);
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.landingsService.stopAbTestGroup(groupId);
  }

  // Настоящее удаление уже завершённого теста из истории (запрос пользователя 2026-07-17) —
  // отдельный роут от "остановить" выше, чтобы не путать два разных действия одним DELETE.
  @Delete('ab-test-groups/:groupId/history')
  @RequirePermission(Permission.AB_TESTS_DELETE)
  async removeHistory(@Param('groupId') groupId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    const projectId = await this.landingsService.getAbTestGroupProjectId(groupId);
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.landingsService.deleteAbTestGroupHistory(groupId);
  }
}
