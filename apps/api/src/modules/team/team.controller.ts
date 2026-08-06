import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { TeamService } from './team.service';

// Класс-уровневый @Roles(OWNER) снят намеренно (запрос пользователя 2026-07-30, роль
// OPERATOR_ADMIN) — RolesGuard's ранговая модель (Math.min(...requiredRoles)) тихо впустила бы
// BUYER/OPERATOR, если бы OPERATOR_ADMIN (тот же ранг 1) попал в общий список декоратора.
// Авторизация теперь явной проверкой роли внутри TeamService (assertCanAccessTeamManagement) —
// JwtAuthGuard (глобальный) по-прежнему требует аутентификацию.
@Controller('team')
export class TeamController {
  constructor(private teamService: TeamService) {}

  @Get()
  findAll(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.teamService.findAll(companyId, user.userId, user.role);
  }

  // Team Analytics (Фаза 3.6) — не связаны с OPERATOR_ADMIN, остаются Owner/Admin-only через
  // обычный ранговый @Roles(OWNER) (Admin проходит наравне с Owner по рангу 4).
  @Roles(UserRole.OWNER)
  @Get('analytics/buyers')
  getBuyerAnalytics(@Company() companyId: string) {
    return this.teamService.getBuyerAnalytics(companyId);
  }

  @Roles(UserRole.OWNER)
  @Get('analytics/projects')
  getProjectComparison(@Company() companyId: string) {
    return this.teamService.getProjectComparison(companyId);
  }

  @Post()
  create(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateTeamMemberDto) {
    return this.teamService.create(companyId, user.userId, user.role, dto);
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
    return this.teamService.remove(companyId, user.userId, user.role, userId);
  }
}
