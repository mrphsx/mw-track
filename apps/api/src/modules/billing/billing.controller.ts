import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { BillingService } from './billing.service';
import { CreateTopUpDto } from './dto/create-topup.dto';
import { CreateHeleketTopUpDto } from './dto/create-heleket-topup.dto';
import { SelectPlanDto } from './dto/select-plan.dto';
import { PAYMENT_NETWORKS } from './providers/payment-network.provider.interface';

@Controller('billing')
export class BillingController {
  constructor(private billingService: BillingService) {}

  // Биллинг — только Owner, даже Admin не проходит (см. RolesGuard: Admin=Owner по рангу,
  // поэтому эта граница не выражается через @Roles(), нужна явная проверка).
  private assertOwner(user: AuthUser): void {
    if (user.role !== UserRole.OWNER && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Управление биллингом доступно только владельцу компании');
    }
  }

  @Get('plans')
  getPlans() {
    return this.billingService.getPlans();
  }

  @Get('networks')
  getNetworks() {
    return PAYMENT_NETWORKS;
  }

  @Get('current')
  getCurrent(@Company() companyId: string) {
    return this.billingService.getCurrentUsage(companyId);
  }

  @Get('transactions')
  findTransactions(@Company() companyId: string) {
    return this.billingService.findTransactions(companyId);
  }

  @Get('invoices')
  findAll(@Company() companyId: string) {
    return this.billingService.findAll(companyId);
  }

  @Post('topup')
  createTopUp(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateTopUpDto) {
    this.assertOwner(user);
    return this.billingService.createTopUp(companyId, dto.amount, dto.network);
  }

  @Get('invoices/:id')
  findOne(@Param('id') id: string, @Company() companyId: string) {
    return this.billingService.findOne(id, companyId);
  }

  @Post('invoices/:id/check')
  async check(@Param('id') id: string, @Company() companyId: string) {
    const invoice = await this.billingService.findOne(id, companyId);
    return this.billingService.checkPayment(invoice);
  }

  @Post('select-plan')
  selectPlan(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SelectPlanDto) {
    this.assertOwner(user);
    return this.billingService.selectPlan(companyId, dto.plan);
  }

  // Готовится к интеграции — без HELEKET_MERCHANT_ID/HELEKET_API_KEY вернёт 500
  // (см. HeleketService/10_BACKEND_BILLING.md). Не выставлено в проде, пока ключей нет.
  @Post('topup/heleket')
  createHeleketTopUp(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateHeleketTopUpDto) {
    this.assertOwner(user);
    return this.billingService.createHeleketTopUp(companyId, dto.amount, dto.network);
  }

  // Запрос от серверов Heleket, не от пользователя — нет JWT, подпись проверяется внутри
  // handleHeleketWebhook (см. WebhooksController.telegramWebhook для того же паттерна).
  @Public()
  @Post('webhooks/heleket')
  async heleketWebhook(@Body() payload: Record<string, unknown>) {
    await this.billingService.handleHeleketWebhook(payload);
    return { ok: true };
  }
}
