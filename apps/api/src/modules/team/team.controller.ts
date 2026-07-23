import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { TeamService } from './team.service';

@Controller('team')
@Roles(UserRole.OWNER)
export class TeamController {
  constructor(private teamService: TeamService) {}

  @Get()
  findAll(@Company() companyId: string) {
    return this.teamService.findAll(companyId);
  }

  // Team Analytics (Фаза 3.6) — двухсегментные пути, с однобуквенным ':userId' ниже не
  // пересекаются (тот же принцип, что и у 'stats/best-time' в PushesController).
  @Get('analytics/buyers')
  getBuyerAnalytics(@Company() companyId: string) {
    return this.teamService.getBuyerAnalytics(companyId);
  }

  @Get('analytics/projects')
  getProjectComparison(@Company() companyId: string) {
    return this.teamService.getProjectComparison(companyId);
  }

  @Post()
  create(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateTeamMemberDto) {
    return this.teamService.create(companyId, user.role, dto);
  }

  @Patch(':userId')
  update(
    @Param('userId') userId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.teamService.update(companyId, user.userId, user.role, userId, dto);
  }

  @Delete(':userId')
  remove(@Param('userId') userId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.teamService.remove(companyId, user.userId, userId);
  }
}
