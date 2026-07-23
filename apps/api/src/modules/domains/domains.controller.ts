import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/permissions/require-permission.decorator';
import { DomainsService } from './domains.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import { UpsertDomainPathDto } from './dto/upsert-domain-path.dto';

@Controller('domains')
export class DomainsController {
  constructor(private domainsService: DomainsService) {}

  @Post()
  @RequirePermission(Permission.DOMAINS_CREATE)
  create(@Company() companyId: string, @Body() dto: CreateDomainDto) {
    return this.domainsService.create(companyId, dto);
  }

  @Get()
  @RequirePermission(Permission.DOMAINS_VIEW)
  findAll(@Company() companyId: string) {
    return this.domainsService.findAll(companyId);
  }

  @Get(':id')
  @RequirePermission(Permission.DOMAINS_VIEW)
  findOne(@Param('id') id: string, @Company() companyId: string) {
    return this.domainsService.findOne(id, companyId);
  }

  @Post(':id/verify')
  @RequirePermission(Permission.DOMAINS_EDIT)
  verify(@Param('id') id: string, @Company() companyId: string) {
    return this.domainsService.verify(id, companyId);
  }

  @Get(':id/paths')
  @RequirePermission(Permission.DOMAINS_VIEW)
  listPaths(@Param('id') id: string, @Company() companyId: string) {
    return this.domainsService.listPaths(id, companyId);
  }

  // Один эндпоинт на создание и редактирование (upsert по domainId+path) — проще для фронта,
  // чем различать create/update пути по тому, существует ли он уже. Требуем DOMAINS_EDIT
  // (не CREATE) — с точки зрения прав это правка домена, а не создание нового домена.
  @Post(':id/paths')
  @RequirePermission(Permission.DOMAINS_EDIT)
  upsertPath(@Param('id') id: string, @Company() companyId: string, @Body() dto: UpsertDomainPathDto, @CurrentUser() user: AuthUser) {
    return this.domainsService.upsertPath(id, companyId, dto, user.userId, user.role);
  }

  @Delete(':id/paths/:pathId')
  @RequirePermission(Permission.DOMAINS_EDIT)
  removePath(@Param('id') id: string, @Param('pathId') pathId: string, @Company() companyId: string) {
    return this.domainsService.removePath(id, pathId, companyId);
  }

  @Delete(':id')
  @RequirePermission(Permission.DOMAINS_DELETE)
  remove(@Param('id') id: string, @Company() companyId: string) {
    return this.domainsService.remove(id, companyId);
  }
}
