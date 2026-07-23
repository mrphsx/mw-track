import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TeamInvitesController } from './team-invites.controller';
import { TeamInvitesService } from './team-invites.service';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TeamController, TeamInvitesController],
  providers: [TeamService, TeamInvitesService],
  // Экспортирован для AdminModule (Фаза 4.3B, запрос пользователя 2026-07-19, дрилл-даун по
  // компании — список команды напрямую, TeamService.findAll уже принимает явный companyId).
  exports: [TeamService],
})
export class TeamModule {}
