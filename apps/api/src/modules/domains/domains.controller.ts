import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Company } from '../../common/decorators/company.decorator';
import { DomainsService } from './domains.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import { UpsertDomainPathDto } from './dto/upsert-domain-path.dto';

@Controller('domains')
export class DomainsController {
  constructor(private domainsService: DomainsService) {}

  @Post()
  create(@Company() companyId: string, @Body() dto: CreateDomainDto) {
    return this.domainsService.create(companyId, dto);
  }

  @Get()
  findAll(@Company() companyId: string) {
    return this.domainsService.findAll(companyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Company() companyId: string) {
    return this.domainsService.findOne(id, companyId);
  }

  @Post(':id/verify')
  verify(@Param('id') id: string, @Company() companyId: string) {
    return this.domainsService.verify(id, companyId);
  }

  @Get(':id/paths')
  listPaths(@Param('id') id: string, @Company() companyId: string) {
    return this.domainsService.listPaths(id, companyId);
  }

  // Один эндпоинт на создание и редактирование (upsert по domainId+path) — проще для фронта,
  // чем различать create/update пути по тому, существует ли он уже.
  @Post(':id/paths')
  upsertPath(@Param('id') id: string, @Company() companyId: string, @Body() dto: UpsertDomainPathDto) {
    return this.domainsService.upsertPath(id, companyId, dto);
  }

  @Delete(':id/paths/:pathId')
  removePath(@Param('id') id: string, @Param('pathId') pathId: string, @Company() companyId: string) {
    return this.domainsService.removePath(id, pathId, companyId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Company() companyId: string) {
    return this.domainsService.remove(id, companyId);
  }
}
