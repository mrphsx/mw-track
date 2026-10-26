import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import { PartialType } from '@nestjs/swagger';
import { BotLinkSource, Permission, UserRole } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolvePixelOwnerId, resolveScopedBuyerId } from '../../common/buyer-scope.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { BotLinksService } from './bot-links.service';

class CreateBotLinkDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsEnum(BotLinkSource)
  source!: BotLinkSource;

  @IsOptional()
  @IsString()
  buyerId?: string | null;

  @IsOptional()
  @IsString()
  pixelId?: string | null;
}

class UpdateBotLinkDto extends PartialType(CreateBotLinkDto) {}

// Права — как у лендингов: ссылка на бота заменяет лендинг при трафике напрямую в бота.
@Controller('projects/:projectId/bot-links')
export class BotLinksController {
  constructor(
    private botLinksService: BotLinksService,
    private projectsService: ProjectsService,
    private prisma: PrismaService,
  ) {}

  @Get()
  async list(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.CHANNEL_VIEW]);
    const scopedBuyerId = await resolveScopedBuyerId(this.prisma, user.userId, user.role);
    return this.botLinksService.list(projectId, companyId, scopedBuyerId);
  }

  @Post()
  async create(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateBotLinkDto) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.LANDINGS_CREATE]);
    // Баер заводит ссылки на себя — иначе его лиды ушли бы в статистику другого баера.
    const buyerId = user.role === UserRole.BUYER ? user.userId : dto.buyerId;
    const pixelOwnerId = await resolvePixelOwnerId(this.prisma, user.userId, user.role);
    return this.botLinksService.create(projectId, companyId, user.userId, { ...dto, buyerId }, pixelOwnerId);
  }

  @Patch(':linkId')
  async update(
    @Param('projectId') projectId: string,
    @Param('linkId') linkId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateBotLinkDto,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.LANDINGS_EDIT]);
    await this.assertOwnLink(projectId, companyId, linkId, user);
    const input = user.role === UserRole.BUYER ? { ...dto, buyerId: undefined } : dto;
    const pixelOwnerId = await resolvePixelOwnerId(this.prisma, user.userId, user.role);
    return this.botLinksService.update(projectId, companyId, linkId, input, pixelOwnerId);
  }

  @Delete(':linkId')
  async remove(@Param('projectId') projectId: string, @Param('linkId') linkId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role, [Permission.LANDINGS_EDIT]);
    await this.assertOwnLink(projectId, companyId, linkId, user);
    return this.botLinksService.remove(projectId, companyId, linkId);
  }

  private async assertOwnLink(projectId: string, companyId: string, linkId: string, user: AuthUser) {
    if (user.role !== UserRole.BUYER) return;
    const link = await this.botLinksService.findOne(projectId, companyId, linkId);
    if (link.buyerId !== user.userId) throw new ForbiddenException('Это ссылка другого баера');
  }
}
