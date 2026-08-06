import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { TeamInvitesService } from './team-invites.service';

// Роуты создания/списка/отзыва — авторизация внутри TeamInvitesService
// (assertCanAccessTeamManagement), НЕ через @Roles() (см. TeamController — тот же гоча с
// RolesGuard's Math.min(...) при добавлении OPERATOR_ADMIN в общий список ролей декоратора).
// Роуты превью/принятия — @Public(), сам токен из ссылки является авторизацией.
@Controller('team-invites')
export class TeamInvitesController {
  constructor(private invitesService: TeamInvitesService) {}

  @Get()
  findAll(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.invitesService.findAll(companyId, user.userId, user.role);
  }

  @Post()
  create(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateInviteDto) {
    return this.invitesService.create(companyId, user.userId, user.role, dto);
  }

  @Delete(':id')
  revoke(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.invitesService.revoke(companyId, user.userId, user.role, id);
  }

  @Public()
  @Get(':token/preview')
  preview(@Param('token') token: string) {
    return this.invitesService.preview(token);
  }

  @Public()
  @Post(':token/accept')
  accept(@Param('token') token: string, @Body() dto: AcceptInviteDto) {
    return this.invitesService.accept(token, dto);
  }
}
