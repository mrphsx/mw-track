import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Company } from '../../common/decorators/company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { ClientsService } from './clients.service';
import { ClientsRepository } from './clients.repository';
import { PurchasesService } from './purchases.service';
import { ClientFiltersDto } from './dto/client-filters.dto';
import { CreatePurchaseDto } from './dto/create-purchase.dto';

@Controller('projects/:projectId/clients')
export class ClientsController {
  constructor(
    private clientsService: ClientsService,
    private clientsRepository: ClientsRepository,
    private purchasesService: PurchasesService,
    private projectsService: ProjectsService,
  ) {}

  @Get()
  async findMany(@Param('projectId') projectId: string, @Company() companyId: string, @Query() filters: ClientFiltersDto) {
    await this.projectsService.findOne(projectId, companyId);
    return this.clientsService.findMany(projectId, filters);
  }

  @Get('stats')
  async stats(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @Query('days') days?: string,
  ) {
    await this.projectsService.findOne(projectId, companyId);
    return this.clientsRepository.getProjectStats(projectId, days ? parseInt(days, 10) : 30);
  }

  @Get('funnel')
  async funnel(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @Query('days') days?: string,
  ) {
    await this.projectsService.findOne(projectId, companyId);
    return this.clientsRepository.getConversionFunnel(projectId, days ? parseInt(days, 10) : 30);
  }

  @Get('export/lookalike')
  async exportLookalike(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @Query('onlyBuyers') onlyBuyers: string,
    @Res() res: Response,
  ) {
    await this.projectsService.findOne(projectId, companyId);
    const csv = await this.clientsService.exportForLookalike(projectId, onlyBuyers !== 'false');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="lookalike_${projectId}.csv"`);
    res.send(csv);
  }

  @Get(':clientId')
  async findOne(@Param('clientId') clientId: string, @Company() companyId: string) {
    return this.clientsService.findOne(clientId, companyId);
  }

  @Get(':clientId/purchases')
  async purchases(@Param('clientId') clientId: string, @Company() companyId: string) {
    await this.clientsService.findOne(clientId, companyId);
    return this.purchasesService.findByClient(clientId);
  }

  @Get(':clientId/events')
  async events(@Param('clientId') clientId: string, @Company() companyId: string) {
    await this.clientsService.findOne(clientId, companyId);
    return this.clientsService.findEvents(clientId);
  }

  @Get(':clientId/pushes')
  async pushes(@Param('clientId') clientId: string, @Company() companyId: string) {
    await this.clientsService.findOne(clientId, companyId);
    return this.clientsService.findPushLogs(clientId);
  }

  @Post(':clientId/purchases')
  async addPurchase(
    @Param('clientId') clientId: string,
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @Body() dto: CreatePurchaseDto,
    @CurrentUser() user: { userId: string },
  ) {
    await this.clientsService.findOne(clientId, companyId);
    return this.purchasesService.create(projectId, clientId, dto, user.userId);
  }

  @Delete(':clientId')
  async remove(@Param('clientId') clientId: string, @Company() companyId: string) {
    await this.clientsService.softDelete(clientId, companyId);
    return { success: true };
  }
}
