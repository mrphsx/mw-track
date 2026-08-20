import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { LandingsService } from './landings.service';
import { CreateAbTestGroupDto, UpdateAbTestGroupDto } from './dto/ab-test-group.dto';

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
  async findAll(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.AB_TESTS_VIEW]);
    return this.landingsService.listAbTestGroups(projectId);
  }

  // Company-wide список (запрос пользователя 2026-08-20: "добавь этот список груп и на странице
  // всех лендингов") — та же видимость, что и у обычных company-wide /landings, просто по
  // AB_TESTS_VIEW вместо LANDINGS_VIEW. Объявлен раньше 'projects/:projectId/ab-test-groups'
  // ниже — не пересекается по числу сегментов пути, но для ясности рядом с остальными
  // двухсегментными объявлениями этого контроллера.
  @Get('ab-test-groups')
  async findAllForCompany(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.landingsService.findAllGroupsForCompany(companyId, user.userId, user.role);
  }

  @Post('projects/:projectId/ab-test-groups')
  async create(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAbTestGroupDto,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.AB_TESTS_CREATE]);
    return this.landingsService.createAbTestGroup(projectId, companyId, dto);
  }

  // Статистика группы целиком (запрос пользователя 2026-07-23: "для груп лэндингов тоже нужна
  // статистика как для обычных лэндингов") — работает и для активного теста (живой пересчёт),
  // и для завершённого (застывший resultsSnapshot), см. LandingsService.getGroupStats.
  @Get('ab-test-groups/:groupId/stats')
  async stats(@Param('groupId') groupId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    const projectId = await this.landingsService.getAbTestGroupProjectId(groupId);
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.AB_TESTS_VIEW]);
    return this.landingsService.getGroupStats(groupId, companyId);
  }

  // Только название (запрос пользователя 2026-08-20: "после создания группы... уже нельзя
  // будет их менять, так как статистика будет неверной") — см. UpdateAbTestGroupDto.
  @Patch('ab-test-groups/:groupId')
  async update(
    @Param('groupId') groupId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAbTestGroupDto,
  ) {
    const projectId = await this.landingsService.getAbTestGroupProjectId(groupId);
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.AB_TESTS_EDIT]);
    return this.landingsService.updateAbTestGroup(groupId, dto);
  }

  @Delete('ab-test-groups/:groupId')
  async remove(@Param('groupId') groupId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    const projectId = await this.landingsService.getAbTestGroupProjectId(groupId);
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.AB_TESTS_EDIT]);
    return this.landingsService.stopAbTestGroup(groupId);
  }

  // Настоящее удаление уже завершённого теста из истории (запрос пользователя 2026-07-17) —
  // отдельный роут от "остановить" выше, чтобы не путать два разных действия одним DELETE.
  @Delete('ab-test-groups/:groupId/history')
  async removeHistory(@Param('groupId') groupId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    const projectId = await this.landingsService.getAbTestGroupProjectId(groupId);
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.AB_TESTS_DELETE]);
    return this.landingsService.deleteAbTestGroupHistory(groupId);
  }
}
