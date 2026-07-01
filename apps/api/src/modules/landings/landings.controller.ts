import { Body, Controller, Delete, Get, Header, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Company } from '../../common/decorators/company.decorator';
import { LandingsService } from './landings.service';
import { LandingRendererService } from './landing-renderer.service';
import { UpdateLandingDto } from './dto/update-landing.dto';

const MAX_ZIP_SIZE = 50 * 1024 * 1024;

@Controller('landings')
export class LandingsController {
  constructor(
    private landingsService: LandingsService,
    private rendererService: LandingRendererService,
  ) {}

  @Get('templates')
  getTemplates() {
    return this.landingsService.getTemplates();
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Company() companyId: string) {
    return this.landingsService.findOne(id, companyId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Company() companyId: string, @Body() dto: UpdateLandingDto) {
    return this.landingsService.update(id, companyId, dto);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @Company() companyId: string) {
    return this.landingsService.publish(id, companyId);
  }

  @Post(':id/unpublish')
  unpublish(@Param('id') id: string, @Company() companyId: string) {
    return this.landingsService.unpublish(id, companyId);
  }

  @Get(':id/preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  preview(@Param('id') id: string, @Company() companyId: string) {
    return this.rendererService.renderPreviewHtml(id, companyId);
  }

  @Post(':id/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ZIP_SIZE } }))
  upload(@Param('id') id: string, @Company() companyId: string, @UploadedFile() file: Express.Multer.File) {
    return this.landingsService.uploadCustomLanding(id, companyId, file);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Company() companyId: string) {
    return this.landingsService.remove(id, companyId);
  }
}
