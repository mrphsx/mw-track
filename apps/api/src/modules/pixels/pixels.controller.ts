import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { PixelsService } from './pixels.service';
import { CreatePixelDto } from './dto/create-pixel.dto';
import { UpdatePixelDto } from './dto/update-pixel.dto';
import { TestPixelEventDto, TestExistingPixelEventDto } from './dto/test-pixel-event.dto';

@Controller('pixels')
export class PixelsController {
  constructor(private pixelsService: PixelsService) {}

  @Post()
  create(@Company() companyId: string, @Body() dto: CreatePixelDto, @CurrentUser() user: AuthUser) {
    return this.pixelsService.create(companyId, dto, user.userId, user.role);
  }

  // Проверка ивента (запрос пользователя 2026-07-29) — до /:id, иначе Nest принял бы "test-event"
  // за :id в GET-роуте ниже.
  @Post('test-event')
  sendTestEvent(
    @Company() companyId: string,
    @Body() dto: TestPixelEventDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.pixelsService.sendTestEvent(companyId, dto, user.userId, user.role, req);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.pixelsService.findOne(id, companyId, user.userId, user.role);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Company() companyId: string, @Body() dto: UpdatePixelDto, @CurrentUser() user: AuthUser) {
    return this.pixelsService.update(id, companyId, dto, user.userId, user.role);
  }

  // Проверка ивента при редактировании (запрос пользователя 2026-07-29) — использует
  // accessToken/testEventCode уже сохранённого пикселя, с опциональными оверрайдами ещё не
  // сохранённых правок формы.
  @Post(':id/test-event')
  sendTestEventForExisting(
    @Param('id') id: string,
    @Company() companyId: string,
    @Body() dto: TestExistingPixelEventDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.pixelsService.sendTestEventForExisting(id, companyId, dto, user.userId, user.role, req);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.pixelsService.deactivate(id, companyId, user.userId, user.role);
  }
}
