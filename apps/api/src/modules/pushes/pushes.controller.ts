import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Company } from '../../common/decorators/company.decorator';
import { SubscriptionLimit } from '../../common/decorators/subscription-limit.decorator';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { ProjectsService } from '../projects/projects.service';
import { PushesService } from './pushes.service';
import { CreatePushDto } from './dto/create-push.dto';
import { UpdatePushDto } from './dto/update-push.dto';

@Controller('projects/:projectId/pushes')
export class PushesController {
  constructor(
    private pushesService: PushesService,
    private projectsService: ProjectsService,
  ) {}

  @Post()
  async create(@Param('projectId') projectId: string, @Company() companyId: string, @Body() dto: CreatePushDto) {
    await this.projectsService.findOne(projectId, companyId);
    return this.pushesService.create(projectId, dto);
  }

  @Get()
  async findAll(@Param('projectId') projectId: string, @Company() companyId: string) {
    await this.projectsService.findOne(projectId, companyId);
    return this.pushesService.findAll(projectId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Param('projectId') projectId: string, @Company() companyId: string) {
    await this.projectsService.findOne(projectId, companyId);
    return this.pushesService.findOne(id, projectId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @Body() dto: UpdatePushDto,
  ) {
    await this.projectsService.findOne(projectId, companyId);
    return this.pushesService.update(id, projectId, dto);
  }

  @Post(':id/recalculate-audience')
  async recalculateAudience(@Param('id') id: string, @Param('projectId') projectId: string, @Company() companyId: string) {
    await this.projectsService.findOne(projectId, companyId);
    return this.pushesService.recalculateAudience(id, projectId);
  }

  @Post(':id/send')
  @SubscriptionLimit('pushes')
  @UseGuards(SubscriptionGuard)
  async send(@Param('id') id: string, @Param('projectId') projectId: string, @Company() companyId: string) {
    await this.projectsService.findOne(projectId, companyId);
    return this.pushesService.send(id, projectId, companyId);
  }

  @Get(':id/logs')
  async findLogs(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    await this.projectsService.findOne(projectId, companyId);
    return this.pushesService.findLogs(id, projectId, page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 50);
  }

  @Delete(':id')
  async cancel(@Param('id') id: string, @Param('projectId') projectId: string, @Company() companyId: string) {
    await this.projectsService.findOne(projectId, companyId);
    return this.pushesService.cancel(id, projectId);
  }
}
