import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Permission } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { ExtraBotsService } from './extra-bots.service';

class AddExtraBotDto {
  @IsString()
  @MaxLength(200)
  token!: string;
}

class UpdateExtraBotManagersDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  managerUsernames!: string[];
}

// Дополнительные боты проекта (2026-10-24) — права как у настроек канала: смотреть CHANNEL_VIEW,
// подключать/менять CHANNEL_MANAGE.
@Controller('projects/:projectId/bots')
export class ExtraBotsController {
  constructor(
    private extraBots: ExtraBotsService,
    private moduleRef: ModuleRef,
  ) {}

  // ProjectsService — лениво через ModuleRef, как в ChannelsController: ChannelsModule не
  // импортирует ProjectsModule напрямую (тот держит forwardRef на ChannelsModule).
  private async assertAccess(projectId: string, companyId: string, user: AuthUser, permission: Permission) {
    await this.moduleRef.get(ProjectsService, { strict: false }).assertAccess(projectId, companyId, user.userId, user.role, [permission]);
  }

  @Get()
  async list(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(projectId, companyId, user, Permission.CHANNEL_VIEW);
    return this.extraBots.list(projectId);
  }

  @Post()
  async add(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: AddExtraBotDto) {
    await this.assertAccess(projectId, companyId, user, Permission.CHANNEL_MANAGE);
    return this.extraBots.add(projectId, companyId, user.userId, dto.token);
  }

  @Patch(':botId/managers')
  async updateManagers(
    @Param('projectId') projectId: string,
    @Param('botId') botId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateExtraBotManagersDto,
  ) {
    await this.assertAccess(projectId, companyId, user, Permission.CHANNEL_MANAGE);
    return this.extraBots.updateManagers(projectId, botId, dto.managerUsernames);
  }

  @Post(':botId/reconnect')
  async reconnect(@Param('projectId') projectId: string, @Param('botId') botId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(projectId, companyId, user, Permission.CHANNEL_MANAGE);
    return this.extraBots.reconnect(projectId, botId);
  }

  @Delete(':botId')
  async remove(@Param('projectId') projectId: string, @Param('botId') botId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(projectId, companyId, user, Permission.CHANNEL_MANAGE);
    return this.extraBots.remove(projectId, botId);
  }
}
