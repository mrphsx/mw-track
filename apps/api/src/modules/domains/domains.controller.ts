import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { DomainsService } from './domains.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import { UpsertDomainPathDto } from './dto/upsert-domain-path.dto';

// DOMAINS_* — единственное исключение из per-project модели прав (решение пользователя
// 2026-07-28: домены технически не привязаны к одному проекту, Domain.projectId ни на что не
// влияет, один домен обслуживает пути разных проектов компании одновременно). Поэтому здесь не
// ProjectsService.assertAccess(projectId, ..., permissions) на каждый роут (нет одного
// конкретного проекта, который был бы "тем самым"), а PermissionsService.assertAnyProjectPermission
// — "есть ли это право хотя бы на одном из проектов пользователя". Реальные пути (upsertPath/
// removePath в DomainsService) всё равно проверяют владение конкретным лендингом/группой A/B-
// теста — путь, в отличие от самого домена, всегда ведёт ровно в один проект.
@Controller('domains')
export class DomainsController {
  constructor(
    private domainsService: DomainsService,
    private permissionsService: PermissionsService,
  ) {}

  @Post()
  async create(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateDomainDto) {
    await this.permissionsService.assertAnyProjectPermission(user.userId, user.role, Permission.DOMAINS_CREATE);
    return this.domainsService.create(companyId, dto);
  }

  @Get()
  async findAll(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.permissionsService.assertAnyProjectPermission(user.userId, user.role, Permission.DOMAINS_VIEW);
    return this.domainsService.findAll(companyId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.permissionsService.assertAnyProjectPermission(user.userId, user.role, Permission.DOMAINS_VIEW);
    return this.domainsService.findOne(id, companyId);
  }

  @Post(':id/verify')
  async verify(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.permissionsService.assertAnyProjectPermission(user.userId, user.role, Permission.DOMAINS_EDIT);
    return this.domainsService.verify(id, companyId);
  }

  @Get(':id/paths')
  async listPaths(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.permissionsService.assertAnyProjectPermission(user.userId, user.role, Permission.DOMAINS_VIEW);
    return this.domainsService.listPaths(id, companyId);
  }

  // Один эндпоинт на создание и редактирование (upsert по domainId+path) — проще для фронта,
  // чем различать create/update пути по тому, существует ли он уже. Требуем DOMAINS_EDIT
  // (не CREATE) — с точки зрения прав это правка домена, а не создание нового домена.
  @Post(':id/paths')
  async upsertPath(@Param('id') id: string, @Company() companyId: string, @Body() dto: UpsertDomainPathDto, @CurrentUser() user: AuthUser) {
    await this.permissionsService.assertAnyProjectPermission(user.userId, user.role, Permission.DOMAINS_EDIT);
    return this.domainsService.upsertPath(id, companyId, dto, user.userId, user.role);
  }

  @Delete(':id/paths/:pathId')
  async removePath(@Param('id') id: string, @Param('pathId') pathId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.permissionsService.assertAnyProjectPermission(user.userId, user.role, Permission.DOMAINS_EDIT);
    return this.domainsService.removePath(id, pathId, companyId, user.userId, user.role);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.permissionsService.assertAnyProjectPermission(user.userId, user.role, Permission.DOMAINS_DELETE);
    return this.domainsService.remove(id, companyId);
  }
}
