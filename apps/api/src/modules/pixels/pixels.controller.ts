import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Company } from '../../common/decorators/company.decorator';
import { PixelsService } from './pixels.service';
import { CreatePixelDto } from './dto/create-pixel.dto';
import { UpdatePixelDto } from './dto/update-pixel.dto';

@Controller('pixels')
export class PixelsController {
  constructor(private pixelsService: PixelsService) {}

  @Post()
  create(@Company() companyId: string, @Body() dto: CreatePixelDto) {
    return this.pixelsService.create(companyId, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Company() companyId: string) {
    return this.pixelsService.findOne(id, companyId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Company() companyId: string, @Body() dto: UpdatePixelDto) {
    return this.pixelsService.update(id, companyId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Company() companyId: string) {
    return this.pixelsService.deactivate(id, companyId);
  }
}
