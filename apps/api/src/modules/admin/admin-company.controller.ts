import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ClientFiltersDto } from '../clients/dto/client-filters.dto';
import { AdminCompanyService } from './admin-company.service';
import { TopUpBalanceDto } from './dto/top-up-balance.dto';
import { UpdateCompanyRestrictionsDto } from './dto/update-company-restrictions.dto';

// Дрилл-даун по одной компании (Фаза 4.3B) — отдельный контроллер от AdminController
// (список/статистика/подписка/ошибки/действия по всей платформе), чтобы не разрастаться в
// один файл; те же @Roles(SUPER_ADMIN) на уровне класса.
@Controller('admin/companies/:id')
@Roles(UserRole.SUPER_ADMIN)
export class AdminCompanyController {
  constructor(private adminCompanyService: AdminCompanyService) {}

  @Get('overview')
  getOverview(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.adminCompanyService.getOverview(id, user.userId);
  }

  @Get('projects')
  getProjects(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.adminCompanyService.getProjects(id, user.userId);
  }

  @Get('projects/:projectId/clients')
  getProjectClients(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @Query() filters: ClientFiltersDto,
  ) {
    return this.adminCompanyService.getProjectClients(id, user.userId, projectId, filters);
  }

  @Get('projects/:projectId/pushes')
  getProjectPushes(@Param('id') id: string, @Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.adminCompanyService.getProjectPushes(id, user.userId, projectId);
  }

  @Get('landings')
  getLandings(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.adminCompanyService.getLandings(id, user.userId);
  }

  @Get('landings/:landingId/preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getLandingPreview(@Param('id') id: string, @Param('landingId') landingId: string, @CurrentUser() user: AuthUser) {
    return this.adminCompanyService.getLandingPreview(id, user.userId, landingId);
  }

  @Get('domains')
  getDomains(@Param('id') id: string) {
    return this.adminCompanyService.getDomains(id);
  }

  @Get('team')
  getTeam(@Param('id') id: string) {
    return this.adminCompanyService.getTeam(id);
  }

  @Post('balance/topup')
  topUpBalance(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: TopUpBalanceDto) {
    return this.adminCompanyService.topUpBalance(id, user.userId, dto);
  }

  @Patch('restrictions')
  updateRestrictions(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateCompanyRestrictionsDto) {
    return this.adminCompanyService.updateRestrictions(id, user.userId, dto);
  }

  @Delete('domains/:domainId')
  forceDeleteDomain(@Param('id') id: string, @Param('domainId') domainId: string, @CurrentUser() user: AuthUser) {
    return this.adminCompanyService.forceDeleteDomain(id, user.userId, domainId);
  }
}
