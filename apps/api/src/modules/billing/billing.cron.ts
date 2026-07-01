import { Cron } from '@nestjs/schedule';
import { Injectable } from '@nestjs/common';
import { BillingService } from './billing.service';

@Injectable()
export class BillingCron {
  constructor(private billingService: BillingService) {}

  // Подстраховка на случай потери BullMQ-job (например, после рестарта Redis) —
  // основная проверка expiresAt уже встроена в checkPayment().
  @Cron('*/5 * * * *')
  async expireStaleInvoices(): Promise<void> {
    await this.billingService.expireStaleInvoices();
  }

  // Каждые 15 минут — продление подписок списанием с баланса (или даунгрейд до TRIAL,
  // если средств не хватило). Не раз в день: SubscriptionGuard блокирует доступ сразу
  // в момент planExpiresAt, независимо от баланса — компания с деньгами на счету не
  // должна ждать до суток восстановления доступа после фактического продления.
  @Cron('*/15 * * * *')
  async renewSubscriptions(): Promise<void> {
    await this.billingService.runRenewals();
  }

  // Повторная попытка перевода владельцу для оплаченных инвойсов, у которых свип
  // не удался (например, газовый кошелёк был временно пуст) — баланс клиента уже
  // зачислен в момент оплаты независимо от этого, повтор касается только перевода владельцу.
  @Cron('*/15 * * * *')
  async retrySweeps(): Promise<void> {
    await this.billingService.retryFailedSweeps();
  }
}
