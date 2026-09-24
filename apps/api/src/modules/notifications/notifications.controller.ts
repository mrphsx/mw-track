import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ConnectNotificationBotDto } from './dto/connect-notification-bot.dto';
import { CreateNotificationRecipientDto, UpdateNotificationRecipientDto } from './dto/notification-recipient.dto';
import { NotificationsService } from './notifications.service';

// Владелец и админ (и SUPER_ADMIN по рангу RolesGuard): бот хранит учётные данные компании и
// получает сведения о её балансе — это не то, что можно выдать баеру/оператору отдельным правом.
@Controller('notifications')
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get('settings')
  getSettings(@Company() companyId: string) {
    return this.notifications.getSettings(companyId);
  }

  @Post('bot')
  connectBot(@Company() companyId: string, @Body() dto: ConnectNotificationBotDto) {
    return this.notifications.connectBot(companyId, dto.token);
  }

  @Delete('bot')
  disconnectBot(@Company() companyId: string) {
    return this.notifications.disconnectBot(companyId);
  }

  @Post('recipients')
  addRecipient(@Company() companyId: string, @Body() dto: CreateNotificationRecipientDto) {
    return this.notifications.addRecipient(companyId, dto);
  }

  @Patch('recipients/:id')
  updateRecipient(@Company() companyId: string, @Param('id') id: string, @Body() dto: UpdateNotificationRecipientDto) {
    return this.notifications.updateRecipient(companyId, id, dto);
  }

  @Delete('recipients/:id')
  removeRecipient(@Company() companyId: string, @Param('id') id: string) {
    return this.notifications.removeRecipient(companyId, id);
  }

  @Post('recipients/:id/test')
  sendTest(@Company() companyId: string, @Param('id') id: string) {
    return this.notifications.sendTest(companyId, id);
  }
}
