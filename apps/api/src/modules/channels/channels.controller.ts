import { Body, Controller, Delete, Get, Param, Patch, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { Company } from '../../common/decorators/company.decorator';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { TestMessageDto } from './dto/test-message.dto';

@Controller('channels')
export class ChannelsController {
  constructor(private channelsService: ChannelsService) {}

  @Post()
  create(@Company() companyId: string, @Body() dto: CreateChannelDto) {
    return this.channelsService.create(companyId, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Company() companyId: string) {
    return this.channelsService.findOne(id, companyId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Company() companyId: string, @Body() dto: UpdateChannelDto) {
    return this.channelsService.update(id, companyId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Company() companyId: string) {
    return this.channelsService.deactivate(id, companyId);
  }

  @Post(':id/test')
  test(@Param('id') id: string, @Company() companyId: string, @Body() dto: TestMessageDto) {
    return this.channelsService.testMessage(id, companyId, dto);
  }

  // Стримим байты фото сами (а не отдаём прямую ссылку Telegram) — она содержит секретный
  // bot token в пути (api.telegram.org/file/bot<token>/...), отдавать такую ссылку клиенту
  // означало бы передать токен в открытом виде.
  @Get(':id/avatar')
  avatar(@Param('id') id: string, @Company() companyId: string, @Res() res: Response) {
    return this.channelsService.streamAvatar(id, companyId, res);
  }

  @Get(':id/health')
  health(@Param('id') id: string, @Company() companyId: string) {
    return this.channelsService.checkHealth(id, companyId);
  }

  // Повторная попытка initialize() без пересоздания канала — частый случай: бот добавлен
  // до того, как пользователь сделал его админом канала, чинить нужно только в Telegram,
  // не пересобирать форму с токеном заново.
  @Post(':id/reactivate')
  reactivate(@Param('id') id: string, @Company() companyId: string) {
    return this.channelsService.reactivate(id, companyId);
  }
}
