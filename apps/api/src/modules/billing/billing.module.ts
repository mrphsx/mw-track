import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingCron } from './billing.cron';
import { CryptoPaymentService } from './crypto-payment.service';
import { HeleketService } from './heleket.service';
import { PaymentMonitoringProcessor } from './payment-monitoring.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'payment-monitoring' })],
  controllers: [BillingController],
  providers: [BillingService, CryptoPaymentService, HeleketService, PaymentMonitoringProcessor, BillingCron],
  exports: [BillingService],
})
export class BillingModule {}
