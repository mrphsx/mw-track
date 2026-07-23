import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/permissions/require-permission.decorator';
import { PixelsService } from './pixels.service';
import { CreatePixelDto } from './dto/create-pixel.dto';
import { UpdatePixelDto } from './dto/update-pixel.dto';

@Controller('pixels')
export class PixelsController {
  constructor(private pixelsService: PixelsService) {}

  @Post()
  @RequirePermission(Permission.PIXELS_CREATE)
  create(@Company() companyId: string, @Body() dto: CreatePixelDto, @CurrentUser() user: AuthUser) {
    return this.pixelsService.create(companyId, dto, user.userId, user.role);
  }

  @Get(':id')
  @RequirePermission(Permission.PIXELS_VIEW)
  findOne(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.pixelsService.findOne(id, companyId, user.userId, user.role);
  }

  @Patch(':id')
  @RequirePermission(Permission.PIXELS_EDIT)
  update(@Param('id') id: string, @Company() companyId: string, @Body() dto: UpdatePixelDto, @CurrentUser() user: AuthUser) {
    return this.pixelsService.update(id, companyId, dto, user.userId, user.role);
  }

  @Delete(':id')
  @RequirePermission(Permission.PIXELS_DELETE)
  remove(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.pixelsService.deactivate(id, companyId, user.userId, user.role);
  }
}
