import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Company } from '../../common/decorators/company.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { BillingService } from './billing.service';
import { CreateTopUpDto } from './dto/create-topup.dto';
import { CreateHeleketTopUpDto } from './dto/create-heleket-topup.dto';
import { SelectPlanDto } from './dto/select-plan.dto';
import { PAYMENT_NETWORKS } from './providers/payment-network.provider.interface';

@Controller('billing')
export class BillingController {
  constructor(private billingService: BillingService) {}

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
  createTopUp(@Company() companyId: string, @Body() dto: CreateTopUpDto) {
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
  selectPlan(@Company() companyId: string, @Body() dto: SelectPlanDto) {
    return this.billingService.selectPlan(companyId, dto.plan);
  }

  // Готовится к интеграции — без HELEKET_MERCHANT_ID/HELEKET_API_KEY вернёт 500
  // (см. HeleketService/10_BACKEND_BILLING.md). Не выставлено в проде, пока ключей нет.
  @Post('topup/heleket')
  createHeleketTopUp(@Company() companyId: string, @Body() dto: CreateHeleketTopUpDto) {
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
