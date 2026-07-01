import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BalanceTransaction, Invoice } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoPaymentService } from './crypto-payment.service';
import { HeleketService } from './heleket.service';
import { PLANS, PURCHASABLE_PLANS, PurchasablePlan } from './plans';
import { PaymentNetwork } from './providers/payment-network.provider.interface';

@Injectable()
export class BillingService {
  constructor(
    private prisma: PrismaService,
    private cryptoPayment: CryptoPaymentService,
    private heleket: HeleketService,
  ) {}

  // Инвойс пополняет баланс — он больше не привязан к конкретному тарифу
  // (см. selectPlan/runRenewals: тариф выбирается и продлевается списанием с баланса).
  // Сеть оплаты выбирает клиент (TRC20/ERC20/BEP20) — каждая обслуживается своим
  // PaymentNetworkProvider через CryptoPaymentService, дальше код сетенезависим.
  async createTopUp(companyId: string, amount: number, network: PaymentNetwork): Promise<Invoice> {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const invoice = await this.prisma.invoice.create({
      data: {
        companyId,
        amount,
        currency: 'USDT',
        network,
        expiresAt,
        status: 'PENDING',
      },
    });

    const address = this.cryptoPayment.generatePaymentAddress(network, invoice.id);
    const updated = await this.prisma.invoice.update({ where: { id: invoice.id }, data: { paymentAddress: address } });

    await this.cryptoPayment.scheduleMonitoring(invoice.id, expiresAt);
    return updated;
  }

  // Готовится к интеграции — без HELEKET_MERCHANT_ID/HELEKET_API_KEY в .env бросит ошибку
  // (HeleketGatewayProvider.createInvoice). В отличие от createTopUp, инвойс создаётся и на
  // нашей стороне (для истории/UI), и на стороне Heleket — нет BullMQ-мониторинга и свипа:
  // Heleket сам следит за платежом и шлёт вебхук, сам зачисляет на свой меречант-баланс.
  async createHeleketTopUp(companyId: string, amount: number, network?: string): Promise<Invoice> {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const invoice = await this.prisma.invoice.create({
      data: { companyId, amount, currency: 'USDT', provider: 'HELEKET', network: network ?? null, expiresAt, status: 'PENDING' },
    });

    let gw;
    try {
      gw = await this.heleket.createInvoice(invoice.id, amount, network);
    } catch (error) {
      // Инвойс никогда не получит адрес/uuid и не сможет быть оплачен — не оставляем его
      // висеть в PENDING до истечения 30 минут, помечаем сразу.
      await this.prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'EXPIRED' } });
      throw error;
    }

    return this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { paymentAddress: gw.paymentAddress, network: gw.network ?? network ?? null, gatewayUuid: gw.gatewayUuid },
    });
  }

  // POST /billing/webhooks/heleket — публичный эндпоинт (нет JWT, запрос от серверов Heleket,
  // не от пользователя), поэтому подпись проверяется здесь явно, а не через guard на companyId.
  async handleHeleketWebhook(payload: Record<string, unknown>): Promise<void> {
    if (!this.heleket.verifyWebhookSignature(payload)) {
      throw new ForbiddenException('Неверная подпись вебхука Heleket');
    }

    const result = this.heleket.parseWebhook(payload);
    if (!result.isPaid) return;

    // order_id — это invoice.id, переданный при createHeleketTopUp; status=PENDING защищает
    // от повторной обработки одного и того же вебхука (Heleket может присылать его повторно).
    const invoice = await this.prisma.invoice.findUnique({ where: { id: result.orderId } });
    if (!invoice || invoice.status !== 'PENDING') return;

    await this.creditBalance(invoice.id, result.txHash ?? result.gatewayUuid, result.paidAmount);
  }

  // Вызывается и BullMQ-процессором (фон, без companyId), и кнопкой "Я оплатил" на дашборде
  // (HTTP-контекст, companyId известен) — поэтому companyId-проверка вынесена в findOne(),
  // а not-found версия для фона — отдельным findOneInternal().
  async checkPayment(invoice: Invoice): Promise<Invoice> {
    if (invoice.status !== 'PENDING') return invoice;

    if (invoice.expiresAt < new Date()) {
      await this.cryptoPayment.stopMonitoring(invoice.id);
      return this.prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'EXPIRED' } });
    }

    const match = await this.cryptoPayment.checkTransaction(
      invoice.network as PaymentNetwork,
      invoice.paymentAddress!,
      Number(invoice.amount),
    );
    if (!match) return invoice;

    return this.creditBalance(invoice.id, match.txHash, match.amount);
  }

  private async creditBalance(invoiceId: string, txHash: string, paidAmount: number): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

    const company = await this.prisma.company.update({
      where: { id: invoice.companyId },
      data: { balance: { increment: paidAmount } },
    });

    await this.prisma.balanceTransaction.create({
      data: {
        companyId: invoice.companyId,
        type: 'TOPUP',
        amount: paidAmount,
        balanceAfter: company.balance,
        invoiceId: invoice.id,
      },
    });

    // HELEKET не мониторится через BullMQ (нет своего адреса — мониторит сам Heleket) —
    // stopMonitoring на чужой/несуществующий jobId безопасный no-op, но вызывать его незачем.
    if (invoice.provider === 'SELF_HOSTED') await this.cryptoPayment.stopMonitoring(invoiceId);

    const paid = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'PAID', paidAt: new Date(), paidAmount, txHash },
    });

    // Свип на счёт владельца — только для SELF_HOSTED: у HELEKET нет адреса, которым мы
    // управляем, средства уже у Heleket на меречант-балансе (вывод — отдельная задача).
    if (paid.provider !== 'SELF_HOSTED') return paid;

    // Best-effort: баланс уже зачислен независимо от результата свипа — деньги клиента
    // учтены, даже если перевод владельцу временно не удался (retryFailedSweeps подхватит).
    return this.attemptSweep(paid);
  }

  private async attemptSweep(invoice: Invoice): Promise<Invoice> {
    try {
      const { txHash: sweepTxHash } = await this.cryptoPayment.sweepToOwner(
        invoice.network as PaymentNetwork,
        invoice.id,
        invoice.paymentAddress!,
        Number(invoice.paidAmount),
      );
      return this.prisma.invoice.update({ where: { id: invoice.id }, data: { sweptAt: new Date(), sweepTxHash, sweepError: null } });
    } catch (error) {
      return this.prisma.invoice.update({ where: { id: invoice.id }, data: { sweepError: (error as Error).message } });
    }
  }

  // Крон каждые 15 минут — повторяет свип для оплаченных инвойсов, у которых
  // предыдущая попытка не удалась (sweepError != null) и которые ещё не свипнуты.
  async retryFailedSweeps(): Promise<void> {
    const pending = await this.prisma.invoice.findMany({
      where: { status: 'PAID', sweptAt: null, sweepError: { not: null } },
    });
    for (const invoice of pending) {
      await this.attemptSweep(invoice);
    }
  }

  // Выбор/смена/ручное продление тарифа — списывает цену плана с баланса немедленно.
  // Не хватает средств — бросает ошибку, ничего не меняется (см. AskUserQuestion-решение
  // пользователя: "сразу, если хватает баланса", без частичной/отложенной активации).
  async selectPlan(companyId: string, plan: PurchasablePlan) {
    const { charged, company } = await this.chargeForPlan(companyId, plan);
    if (!charged) {
      throw new BadRequestException(
        `Недостаточно средств: нужно ${PLANS[plan].priceUsdt} USDT, на балансе ${company.balance} USDT. Пополните баланс.`,
      );
    }
    return company;
  }

  // Атомарное условное списание (UPDATE ... WHERE balance >= price) — без него гонка
  // двух параллельных вызовов (ручной выбор тарифа + крон продления) могла бы списать
  // цену дважды с одного баланса, не успев перепроверить остаток между ними.
  private async chargeForPlan(companyId: string, plan: PurchasablePlan) {
    const config = PLANS[plan];

    const result = await this.prisma.company.updateMany({
      where: { id: companyId, balance: { gte: config.priceUsdt } },
      data: {
        plan,
        planExpiresAt: new Date(Date.now() + config.durationDays * 24 * 60 * 60 * 1000),
        maxProjects: config.maxProjects,
        maxClients: config.maxClients,
        maxPushesPerMonth: config.maxPushesPerMonth,
        balance: { decrement: config.priceUsdt },
      },
    });

    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    if (result.count === 0) return { charged: false, company };

    await this.prisma.balanceTransaction.create({
      data: {
        companyId,
        type: 'SUBSCRIPTION_CHARGE',
        amount: -config.priceUsdt,
        balanceAfter: company.balance,
        plan,
      },
    });

    return { charged: true, company };
  }

  private async downgradeToTrial(companyId: string): Promise<void> {
    const limits = PLANS.TRIAL;

    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        plan: 'TRIAL',
        planExpiresAt: null, // не продлевается автоматически — крон больше не выберет эту компанию
        maxProjects: limits.maxProjects,
        maxClients: limits.maxClients,
        maxPushesPerMonth: limits.maxPushesPerMonth,
      },
    });

    await this.prisma.balanceTransaction.create({
      data: { companyId, type: 'DOWNGRADE', amount: 0, balanceAfter: company.balance, plan: 'TRIAL' },
    });
  }

  // Вызывается BillingCron раз в день. Компании на покупном тарифе с истёкшим
  // planExpiresAt — либо списываем цену плана и продлеваем ещё на durationDays
  // от текущего момента, либо (не хватило баланса) даунгрейдим до TRIAL.
  async runRenewals(): Promise<void> {
    const due = await this.prisma.company.findMany({
      where: {
        plan: { in: [...PURCHASABLE_PLANS] },
        planExpiresAt: { lte: new Date() },
        deletedAt: null,
      },
    });

    for (const company of due) {
      const { charged } = await this.chargeForPlan(company.id, company.plan as PurchasablePlan);
      if (!charged) await this.downgradeToTrial(company.id);
    }
  }

  async findAll(companyId: string): Promise<Invoice[]> {
    return this.prisma.invoice.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string, companyId: string): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findFirst({ where: { id, companyId } });
    if (!invoice) throw new NotFoundException('Счёт не найден');
    return invoice;
  }

  // Без companyId-фильтра — для BullMQ-процессора (фоновый контекст, см. инвариант
  // company-scoping в 04_BACKEND_CORE.md: он покрывает только HTTP-запросы).
  async findOneInternal(id: string): Promise<Invoice | null> {
    return this.prisma.invoice.findUnique({ where: { id } });
  }

  async findTransactions(companyId: string): Promise<BalanceTransaction[]> {
    return this.prisma.balanceTransaction.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  }

  getPlans() {
    return PLANS;
  }

  async getCurrentUsage(companyId: string) {
    return this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        plan: true,
        planExpiresAt: true,
        balance: true,
        maxProjects: true,
        currentProjects: true,
        maxClients: true,
        currentClients: true,
        maxPushesPerMonth: true,
        pushesThisMonth: true,
      },
    });
  }

  async expireStaleInvoices(): Promise<void> {
    const stale = await this.prisma.invoice.findMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    });
    for (const invoice of stale) {
      await this.cryptoPayment.stopMonitoring(invoice.id);
      await this.prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'EXPIRED' } });
    }
  }
}
