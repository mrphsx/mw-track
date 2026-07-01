import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubscriptionLimit } from '../../common/decorators/subscription-limit.decorator';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

interface AuthUser {
  userId: string;
  companyId: string;
  role: UserRole;
}

@Controller('projects')
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Get()
  findAll(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.projectsService.findAll(companyId, user.userId, user.role);
  }

  @Post()
  @SubscriptionLimit('projects')
  @UseGuards(SubscriptionGuard)
  create(@Company() companyId: string, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(companyId, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Company() companyId: string) {
    return this.projectsService.findOne(id, companyId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Company() companyId: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(id, companyId, dto);
  }

  @Delete(':id')
  archive(@Param('id') id: string, @Company() companyId: string) {
    return this.projectsService.archive(id, companyId);
  }

  @Post(':id/tokens')
  regenerateTokens(@Param('id') id: string, @Company() companyId: string) {
    return this.projectsService.regenerateTokens(id, companyId);
  }

  @Get(':id/snippet')
  getSnippet(@Param('id') id: string, @Company() companyId: string) {
    return this.projectsService.getSnippet(id, companyId);
  }

  @Get(':id/overview')
  getOverview(@Param('id') id: string, @Company() companyId: string, @Query('days') days?: string) {
    return this.projectsService.getOverview(id, companyId, days ? parseInt(days, 10) : 30);
  }
}
