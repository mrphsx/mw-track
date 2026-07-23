import { Body, Controller, Get, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/permissions/require-permission.decorator';
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
  @RequirePermission(Permission.LANDINGS_VIEW)
  async findAll(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.landingsService.findAll(projectId, companyId);
  }

  @Post()
  @RequirePermission(Permission.LANDINGS_CREATE)
  async create(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateLandingFromTemplateDto,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.landingsService.createFromTemplate(projectId, companyId, dto);
  }

  @Post('custom')
  @RequirePermission(Permission.LANDINGS_CREATE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ZIP_SIZE } }))
  async createCustom(
    @Param('projectId') projectId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadCustomLandingDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.projectsService.assertAccess(projectId, companyId, user.userId, user.role);
    return this.landingsService.createCustom(projectId, companyId, dto, file);
  }
}
