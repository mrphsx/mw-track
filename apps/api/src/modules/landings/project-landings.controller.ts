import { Body, Controller, Get, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Company } from '../../common/decorators/company.decorator';
import { ProjectsService } from '../projects/projects.service';
import { LandingsService } from './landings.service';
import { CreateLandingFromTemplateDto } from './dto/create-landing-from-template.dto';
import { UploadCustomLandingDto } from './dto/upload-custom-landing.dto';

const MAX_ZIP_SIZE = 50 * 1024 * 1024;

@Controller('projects/:projectId/landings')
export class ProjectLandingsController {
  constructor(
    private landingsService: LandingsService,
    private projectsService: ProjectsService,
  ) {}

  @Get()
  async findAll(@Param('projectId') projectId: string, @Company() companyId: string) {
    await this.projectsService.findOne(projectId, companyId);
    return this.landingsService.findAll(projectId, companyId);
  }

  @Post()
  async create(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @Body() dto: CreateLandingFromTemplateDto,
  ) {
    await this.projectsService.findOne(projectId, companyId);
    return this.landingsService.createFromTemplate(projectId, companyId, dto);
  }

  @Post('custom')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ZIP_SIZE } }))
  async createCustom(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @Body() dto: UploadCustomLandingDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.projectsService.findOne(projectId, companyId);
    return this.landingsService.createCustom(projectId, companyId, dto, file);
  }
}
