import { Controller, Get, Param, Post } from '@nestjs/common';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { NoticesService } from './notices.service';

// Колокол оповещений в СРМ — доступен ЛЮБОМУ авторизованному сотруднику компании (в отличие от
// настроек бота оповещений, которые Owner-only): объявление платформы адресовано всем, кто
// работает в системе, и состояние "прочитано"/"скрыто" у каждого своё.
@Controller('notices')
export class NoticesController {
  constructor(private noticesService: NoticesService) {}

  @Get()
  list(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.noticesService.listForUser(companyId, user.userId);
  }

  // Объявлено до ':id/read' не требуется — путь другой, коллизии нет.
  @Post('clear')
  clearAll(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.noticesService.clearAllForUser(companyId, user.userId);
  }

  @Post(':id/read')
  markRead(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.noticesService.markRead(companyId, user.userId, id);
  }
}
