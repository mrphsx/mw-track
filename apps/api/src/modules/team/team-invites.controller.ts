import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { TeamInvitesService } from './team-invites.service';

// Роуты создания/списка/отзыва — Owner-only (Admin проходит по рангу RolesGuard). Роуты
// превью/принятия — @Public(), сам токен из ссылки является авторизацией (см. TeamInvitesService).
@Controller('team-invites')
export class TeamInvitesController {
  constructor(private invitesService: TeamInvitesService) {}

  @Get()
  @Roles(UserRole.OWNER)
  findAll(@Company() companyId: string) {
    return this.invitesService.findAll(companyId);
  }

  @Post()
  @Roles(UserRole.OWNER)
  create(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateInviteDto) {
    return this.invitesService.create(companyId, user.userId, user.role, dto);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER)
  revoke(@Param('id') id: string, @Company() companyId: string) {
    return this.invitesService.revoke(companyId, id);
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
