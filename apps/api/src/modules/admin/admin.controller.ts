import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { UpdateCompanySubscriptionDto } from './dto/update-company-subscription.dto';

// Super Admin панель (Фаза 4.3, запрос пользователя 2026-07-19) — единственный контроллер в
// проекте, гейтящийся строго ролью SUPER_ADMIN (@Roles(), уже существующий глобальный
// RolesGuard — ранг 5 против 4 у OWNER/ADMIN, коллизии рангов нет, доп. гвард не нужен).
// Никогда не вызывает assertAccess/@Company() — эти роуты обязаны видеть ВСЕ компании, не
// только компанию вызывающего.
@Controller('admin')
@Roles(UserRole.SUPER_ADMIN)
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('companies')
  getCompanies(@Query('search') search?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.getCompanies(search, page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 50);
  }

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Patch('companies/:id/subscription')
  updateSubscription(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateCompanySubscriptionDto) {
    return this.adminService.updateSubscription(id, user.userId, dto);
  }

  @Get('errors')
  getErrors(@Query('companyId') companyId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.getErrors(companyId, page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 50);
  }

  @Get('actions')
  getActions(@Query('companyId') companyId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.getActions(companyId, page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 50);
  }
}
