import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { BillingService } from './billing.service';
import { CryptoPaymentService } from './crypto-payment.service';

@Processor('payment-monitoring')
export class PaymentMonitoringProcessor {
  private readonly logger = new Logger(PaymentMonitoringProcessor.name);

  constructor(
    private billingService: BillingService,
    private cryptoPayment: CryptoPaymentService,
  ) {}

  @Process('check-payment')
  async handle(job: Job<{ invoiceId: string }>): Promise<void> {
    const invoice = await this.billingService.findOneInternal(job.data.invoiceId);
    if (!invoice) {
      // Без явной остановки repeatable job продолжал бы стучаться в TronGrid каждые 15с
      // навечно — найдено живьём: инвойсы тестовых компаний удалили напрямую из БД,
      // а их BullMQ-джобы остались в Redis и пережили рестарт сервера.
      this.logger.warn(`Invoice ${job.data.invoiceId} не найден — останавливаю мониторинг`);
      await this.cryptoPayment.stopMonitoring(job.data.invoiceId);
      return;
    }
    await this.billingService.checkPayment(invoice);
  }
}
