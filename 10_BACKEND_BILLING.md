# 10_BACKEND_BILLING.md — Crypto-оплата, баланс, подписки, лимиты

## Зачем

Подписка компании (`Company.plan`) даёт доступ к фичам и лимитам (`maxProjects`/`maxClients`/`maxPushesPerMonth`,
проверяются `SubscriptionGuard`, см. [04_BACKEND_CORE.md](04_BACKEND_CORE.md)). Оплата устроена в два независимых шага:

1. **Пополнение баланса** — крипто-инвойс на произвольную сумму, не привязанную ни к какому тарифу, в одной
   из трёх сетей USDT по выбору клиента: TRC-20 (TRON), ERC-20 (Ethereum), BEP-20 (BSC). На каждый счёт
   (`Invoice`) генерируется свой одноразовый адрес — проще для сверки платежей, чем общий адрес для всех
   клиентов (не нужно парсить memo/комментарий к платежу, которого по умолчанию нет ни в TRC-20, ни в EVM-сетях).
   После зачисления оплата автоматически переводится ("свипается") на адрес владельца — см. раздел ниже.
2. **Выбор/продление тарифа** — списание цены тарифа с уже пополненного баланса. Происходит либо вручную
   (кнопка "Выбрать"/"Продлить сейчас" — применяется сразу, если хватает баланса), либо автоматически кроном
   раз в 15 минут для тарифов с истёкшим `planExpiresAt`. Не хватило баланса на автопродление — компания
   сбрасывается на TRIAL (бесплатный, не истекает), а не блокируется/приостанавливается.

Решение пройти именно через промежуточный баланс (а не как раньше — инвойс сразу на конкретный тариф) принято,
чтобы продление подписки не требовало от пользователя каждый раз заново платить крипто-транзакцией: достаточно
один раз пополнить баланс, дальше система сама списывает по графику.

## Архитектура: пополнение баланса (top-up)

```
POST /billing/topup {amount}
        |
        v
BillingService.createTopUp()
        |  создаёт Invoice (status=PENDING, expiresAt=+30мин, без привязки к тарифу)
        v
CryptoPaymentService.generatePaymentAddress(invoiceId)
        |  HD-кошелёк TRC-20: один адрес на инвойс,
        |  выводится детерминированно из invoiceId (см. "Деривация адреса" ниже)
        v
Invoice.paymentAddress = "Txxxxx..."
        |
        v
BullMQ payment-monitoring: repeatable job (каждые 15с, до expiresAt)
        |
        v
CryptoPaymentService.checkTronTransaction(address, expectedAmount)
        |  TronGrid API: TRC20 transfer events контракта USDT на этот адрес
        |
        +-- найден платёж >= ожидаемой суммы --> BillingService.creditBalance()
        |         |
        |         v
        |   Company.balance += paidAmount, BalanceTransaction(TOPUP) создаётся,
        |   Invoice.status=PAID, stopMonitoring(invoiceId)
        |
        +-- expiresAt истёк, платежа нет --> Invoice.status=EXPIRED, stopMonitoring(invoiceId)
```

## Архитектура: выбор тарифа и автопродление

```
POST /billing/select-plan {plan}                  BillingCron.renewSubscriptions() — каждые 15 мин
        |                                                  |
        v                                                  v
BillingService.selectPlan(companyId, plan)         находит компании с plan IN (STARTER/GROWTH/SCALE)
        |                                           и planExpiresAt <= now
        v                                                  |
BillingService.chargeForPlan(companyId, plan)  <-----------+  (тот же метод для ручного и автоматического пути)
        |
        |  атомарное условное списание:
        |  UPDATE Company SET balance = balance - price, plan = ..., planExpiresAt = now + durationDays, ...
        |  WHERE id = companyId AND balance >= price
        |
        +-- count = 1 (хватило) --> BalanceTransaction(SUBSCRIPTION_CHARGE, -price) создаётся
        |                            ручной вызов: возвращает обновлённую компанию
        |                            крон: переходит к следующей компании в очереди
        |
        +-- count = 0 (не хватило) --> ручной вызов: 400 Bad Request, ничего не меняется
                                        крон: BillingService.downgradeToTrial(companyId) —
                                        plan=TRIAL, planExpiresAt=null (бессрочно, не продлевается),
                                        лимиты TRIAL, BalanceTransaction(DOWNGRADE, amount=0)
```

Почему `chargeForPlan` — атомарный `updateMany` с условием в `WHERE`, а не "прочитать баланс → проверить →
списать": без этого параллельный ручной выбор тарифа и крон продления (или два конкурентных запроса) могли бы
оба прочитать одинаковый "достаточный" баланс и списать цену дважды.

Почему крон каждые 15 минут, а не раз в день: `SubscriptionGuard` блокирует доступ сразу в момент
`planExpiresAt`, независимо от баланса (см. [04_BACKEND_CORE.md](04_BACKEND_CORE.md)). Компания с деньгами на
счету не должна сутки ждать восстановления доступа после фактического продления.

Почему даунгрейд именно до TRIAL с `planExpiresAt: null`, а не приостановка/блокировка: `SubscriptionGuard`
уже трактует `planExpiresAt === null` как "не истекает" — переиспользуем существующую семантику вместо нового
статуса "suspended". TRIAL бессрочен после даунгрейда (в отличие от настоящего TRIAL при регистрации, который
получает реальный 7-дневный `planExpiresAt`, см. `AuthService.register`).

## Сети оплаты: PaymentNetworkProvider

Три сети (TRC-20/ERC-20/BEP-20) реализованы через тот же паттерн, что и `ChannelProvider`/`PixelProvider`:
один интерфейс, диспетчеризация по карте `Record<PaymentNetwork, PaymentNetworkProvider>` в
`CryptoPaymentService`, никаких if/else в `BillingService` — он просто передаёт `invoice.network` дальше.

```typescript
export interface PaymentNetworkProvider {
  generateAddress(invoiceId: string): string;
  checkTransaction(address: string, expectedAmount: number): Promise<PaymentMatch | null>;
  sweepToOwner(invoiceId: string, address: string, amount: number): Promise<SweepResult>;
}
```

`TronUsdtProvider` — TronWeb, как и раньше. `EvmUsdtProvider` — один параметризуемый класс (ethers.js) на
обе EVM-сети (Ethereum/BSC), а не два почти одинаковых: формат адреса и деривация secp256k1 у них идентичны,
отличаются только RPC-эндпоинт/контракт USDT/decimals/газ. Добавить ещё EVM-сеть (Polygon, Arbitrum...) — это
третий конфиг-объект, не новый класс. Оба провайдера — обычные TS-классы, не `@Injectable()`: `CryptoPaymentService`
сам резолвит конфиг через `ConfigService` и создаёт экземпляры в конструкторе (`new TronUsdtProvider(...)`,
`new EvmUsdtProvider(...)` × 2) — единственное намеренное отклонение от буквального DI-паттерна `ChannelsService`,
потому что EVM-провайдеру нужно N по-разному сконфигурированных инстансов одного класса, а не N разных классов.

**Важная ловушка с decimals**: USDT на Ethereum и USDT (TRC-20) на TRON — 6 знаков после запятой, но
Binance-Peg USDT на BSC — **18 знаков**. Если захардкодить 6 для всех сетей, суммы на BEP-20 будут
неверны на 12 порядков. `EvmProviderConfig.usdtDecimals` явно разное для ERC20 (6) и BEP20 (18).

## Деривация адреса (без миграции схемы)

В `Invoice` нет поля под индекс деривации — заводить его специально под MVP не стали.
Вместо этого индекс выводится детерминированно из `invoice.id` (cuid, уникален и неизменен), одинаково
для всех сетей (TRON: `m/44'/195'/0'/0/{index}`, EVM: `m/44'/60'/0'/0/{index}`):

```typescript
function deriveIndex(invoiceId: string): number {
  const hash = crypto.createHash('sha256').update(invoiceId).digest('hex');
  return parseInt(hash.slice(0, 8), 16) % 0x7fffffff; // в пределах non-hardened индекса BIP44
}
```

Приватный ключ существует только в момент деривации (внутри `generateAddress`/`sweepToOwner`) и никогда не
пишется в БД — только адрес. Мнемоника HD-кошелька (`TRON_HD_MNEMONIC` для TRC-20, `ETH_HD_MNEMONIC` для
обеих EVM-сетей сразу — один и тот же кошелёк работает на Ethereum и BSC) — в `.env`, не в БД, не в логах.

## Свип на счёт владельца

Каждый адрес инвойса свежедеривирован и не имеет нативного газа (TRX/ETH/BNB) — TRC-20/ERC-20/BEP-20 трансфер
без газа на отправителе невозможен на любой из трёх сетей. Поэтому свип — два шага, одинаковых для всех сетей
(`TronUsdtProvider.sweepToOwner`/`EvmUsdtProvider.sweepToOwner`):

1. Отдельный газовый кошелёк (`TRON_GAS_PRIVATE_KEY`/`ETH_GAS_PRIVATE_KEY`/`BSC_GAS_PRIVATE_KEY` — **не** из
   HD-мнемоники инвойсов, изоляция намеренная) присылает немного нативной монеты на адрес инвойса.
2. С адреса инвойса (приватный ключ выводится из `invoiceId` тем же путём, что и при генерации адреса) весь
   полученный USDT уходит на `OWNER_PAYOUT_ADDRESS_TRC20` (TRC-20) или `OWNER_PAYOUT_ADDRESS_EVM` (ERC-20 и
   BEP-20 — один адрес на обе EVM-сети). Остаток газа на адресе инвойса не возвращается — известное
   упрощение MVP, не баг.

Свип — best-effort и **не блокирует зачисление баланса**: баланс клиента обновляется в `creditBalance` сразу
по детектированному платежу, независимо от результата свипа. Результат пишется на сам `Invoice`
(`sweptAt`/`sweepTxHash`/`sweepError`); если свип не удался (газовый кошелёк пуст, RPC недоступен и т.п.),
`BillingCron.retrySweeps` (каждые 15 минут) повторяет попытку для всех `status=PAID, sweptAt=null, sweepError!=null`.
Без настроенных `*_GAS_PRIVATE_KEY`/`OWNER_PAYOUT_ADDRESS_*` свип просто не выполняется и тихо пишет ошибку —
оплата всё равно зачисляется на баланс компании.

## Тарифы (PLANS)

```typescript
export const PLANS: Record<SubscriptionPlan, PlanConfig> = {
  TRIAL:      { priceUsdt: 0,   durationDays: 14, maxProjects: 1,   maxClients: 1000,   maxPushesPerMonth: 5   },
  STARTER:    { priceUsdt: 49,  durationDays: 30, maxProjects: 3,   maxClients: 5000,   maxPushesPerMonth: 10  },
  GROWTH:     { priceUsdt: 149, durationDays: 30, maxProjects: 10,  maxClients: 25000,  maxPushesPerMonth: 50  },
  SCALE:      { priceUsdt: 399, durationDays: 30, maxProjects: 30,  maxClients: 100000, maxPushesPerMonth: 999 },
  ENTERPRISE: { priceUsdt: 0,   durationDays: 30, maxProjects: 999, maxClients: 999999, maxPushesPerMonth: 999 },
};

export const PURCHASABLE_PLANS = ['STARTER', 'GROWTH', 'SCALE'] as const;
```

`TRIAL`/`ENTERPRISE` не входят в `PURCHASABLE_PLANS` — не продаются/не продлеваются через баланс:
TRIAL выдаётся бесплатно при регистрации и при даунгрейде, ENTERPRISE — индивидуальные условия (не
автоматизировано). `selectPlan`/`runRenewals` работают только с `PURCHASABLE_PLANS`.

## Модели данных

`Company.balance` (`Decimal @db.Decimal(10,2)`, по умолчанию `0`) — баланс компании в USDT.

`Invoice` больше не хранит `plan`/`planDurationDays` — это просто пополнение баланса на `amount` в выбранной
`network` (`TRC20`/`ERC20`/`BEP20`), без привязки к тарифу. Поля `sweptAt`/`sweepTxHash`/`sweepError` —
результат автоматического перевода оплаты на счёт владельца (см. "Свип на счёт владельца" выше).

`BalanceTransaction` — леджер всех движений баланса, один источник правды для истории операций в UI:

```prisma
model BalanceTransaction {
  id           String                 @id @default(cuid())
  companyId    String
  type         BalanceTransactionType // TOPUP | SUBSCRIPTION_CHARGE | DOWNGRADE
  amount       Decimal                @db.Decimal(10, 2) // + для TOPUP, - для SUBSCRIPTION_CHARGE, 0 для DOWNGRADE
  balanceAfter Decimal                @db.Decimal(10, 2)
  plan         SubscriptionPlan?      // на какой тариф списание/даунгрейд — не задан для TOPUP
  invoiceId    String?                // какой инвойс пополнил баланс — только для TOPUP
  createdAt    DateTime               @default(now())
}
```

Append-only: записи никогда не удаляются и не редактируются — это аудиторский журнал, а не рабочая
таблица, поэтому на неё не распространяется инвариант про `deletedAt` (как и не распространялся бы на
любой чисто событийный лог).

## DTO

```typescript
export class CreateTopUpDto {
  @IsNumber()
  @Min(10) // минимальная сумма пополнения — отсечь инвойсы-пыль
  amount: number;
}

export class SelectPlanDto {
  @IsIn(PURCHASABLE_PLANS)
  plan: PurchasablePlan;
}
```

## CryptoPaymentService

Оркестратор — резолвит конфиг каждой сети через `ConfigService` в конструкторе, создаёт три провайдера
(`TronUsdtProvider`/`EvmUsdtProvider` × 2) и просто диспетчеризует по `PaymentNetwork`. BullMQ-мониторинг
(`scheduleMonitoring`/`stopMonitoring`) сетенезависим — остаётся здесь, не в провайдерах.

```typescript
@Injectable()
export class CryptoPaymentService {
  private readonly providers: Record<PaymentNetwork, PaymentNetworkProvider>;

  constructor(private config: ConfigService, @InjectQueue('payment-monitoring') private queue: Queue) {
    this.providers = {
      TRC20: new TronUsdtProvider({ /* fullHost, apiKey, usdtContract, hdMnemonic, gasPrivateKey, payoutAddress, gasTrxAmount */ }),
      ERC20: new EvmUsdtProvider({ chainName: 'Ethereum', usdtDecimals: 6, /* rpcUrl, usdtContract, explorerApiUrl, ... */ }),
      BEP20: new EvmUsdtProvider({ chainName: 'BSC', usdtDecimals: 18, /* Binance-Peg USDT — 18 знаков, не 6 */ }),
    };
  }

  private getProvider(network: PaymentNetwork) { return this.providers[network]; }

  generatePaymentAddress(network: PaymentNetwork, invoiceId: string): string {
    return this.getProvider(network).generateAddress(invoiceId);
  }

  async checkTransaction(network: PaymentNetwork, address: string, expectedAmount: number) {
    return this.getProvider(network).checkTransaction(address, expectedAmount);
  }

  async sweepToOwner(network: PaymentNetwork, invoiceId: string, address: string, amount: number) {
    return this.getProvider(network).sweepToOwner(invoiceId, address, amount);
  }

  async scheduleMonitoring(invoiceId: string, expiresAt: Date): Promise<void> {
    await this.queue.add('check-payment', { invoiceId },
      { jobId: `invoice-${invoiceId}`, repeat: { every: 15_000, endDate: expiresAt }, removeOnComplete: true });
  }

  async stopMonitoring(invoiceId: string): Promise<void> {
    const repeatableJobs = await this.queue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.id === `invoice-${invoiceId}`);
    if (job) await this.queue.removeRepeatableByKey(job.key);
  }
}
```

Полная реализация `TronUsdtProvider`/`EvmUsdtProvider` (включая деривацию ключей и сам свип) — в
`apps/api/src/modules/billing/providers/`, см. разделы "Сети оплаты" и "Свип на счёт владельца" выше.

## BillingService

```typescript
@Injectable()
export class BillingService {
  constructor(
    private prisma: PrismaService,
    private cryptoPayment: CryptoPaymentService,
  ) {}

  // network — выбор клиента (TRC20/ERC20/BEP20), дальше код не знает деталей конкретной сети
  async createTopUp(companyId: string, amount: number, network: PaymentNetwork): Promise<Invoice> {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const invoice = await this.prisma.invoice.create({
      data: { companyId, amount, currency: 'USDT', network, expiresAt, status: 'PENDING' },
    });
    const address = this.cryptoPayment.generatePaymentAddress(network, invoice.id);
    const updated = await this.prisma.invoice.update({ where: { id: invoice.id }, data: { paymentAddress: address } });
    await this.cryptoPayment.scheduleMonitoring(invoice.id, expiresAt);
    return updated;
  }

  async checkPayment(invoice: Invoice): Promise<Invoice> {
    if (invoice.status !== 'PENDING') return invoice;
    if (invoice.expiresAt < new Date()) {
      await this.cryptoPayment.stopMonitoring(invoice.id);
      return this.prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'EXPIRED' } });
    }
    const match = await this.cryptoPayment.checkTransaction(invoice.network as PaymentNetwork, invoice.paymentAddress!, Number(invoice.amount));
    if (!match) return invoice;
    return this.creditBalance(invoice.id, match.txHash, match.amount);
  }

  // После зачисления — attemptSweep(paid) (best-effort, см. "Свип на счёт владельца" выше):
  // баланс уже зачислен независимо от результата свипа.
  private async creditBalance(invoiceId: string, txHash: string, paidAmount: number): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const company = await this.prisma.company.update({
      where: { id: invoice.companyId },
      data: { balance: { increment: paidAmount } },
    });
    await this.prisma.balanceTransaction.create({
      data: { companyId: invoice.companyId, type: 'TOPUP', amount: paidAmount, balanceAfter: company.balance, invoiceId: invoice.id },
    });
    await this.cryptoPayment.stopMonitoring(invoiceId);
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'PAID', paidAt: new Date(), paidAmount, txHash },
    });
  }

  async selectPlan(companyId: string, plan: PurchasablePlan) {
    const { charged, company } = await this.chargeForPlan(companyId, plan);
    if (!charged) {
      throw new BadRequestException(
        `Недостаточно средств: нужно ${PLANS[plan].priceUsdt} USDT, на балансе ${company.balance} USDT. Пополните баланс.`,
      );
    }
    return company;
  }

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
      data: { companyId, type: 'SUBSCRIPTION_CHARGE', amount: -config.priceUsdt, balanceAfter: company.balance, plan },
    });
    return { charged: true, company };
  }

  private async downgradeToTrial(companyId: string): Promise<void> {
    const limits = PLANS.TRIAL;
    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: { plan: 'TRIAL', planExpiresAt: null, maxProjects: limits.maxProjects, maxClients: limits.maxClients, maxPushesPerMonth: limits.maxPushesPerMonth },
    });
    await this.prisma.balanceTransaction.create({
      data: { companyId, type: 'DOWNGRADE', amount: 0, balanceAfter: company.balance, plan: 'TRIAL' },
    });
  }

  async runRenewals(): Promise<void> {
    const due = await this.prisma.company.findMany({
      where: { plan: { in: [...PURCHASABLE_PLANS] }, planExpiresAt: { lte: new Date() }, deletedAt: null },
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
      select: { plan: true, planExpiresAt: true, balance: true, maxProjects: true, currentProjects: true,
        maxClients: true, currentClients: true, maxPushesPerMonth: true, pushesThisMonth: true },
    });
  }
}
```

Почему `chargeForPlan` используется и из `selectPlan` (ручной путь), и из `runRenewals` (крон) — единая
точка с атомарным списанием, чтобы бизнес-правило "списать цену плана, если хватает баланса" не дублировалось
в двух местах с риском разойтись.

## BullMQ payment-monitoring процессор

```typescript
@Processor('payment-monitoring')
export class PaymentMonitoringProcessor {
  constructor(private billingService: BillingService) {}

  @Process('check-payment')
  async handle(job: Job<{ invoiceId: string }>): Promise<void> {
    const invoice = await this.billingService.findOneInternal(job.data.invoiceId);
    if (invoice) await this.billingService.checkPayment(invoice);
  }
}
```

`findOneInternal` — версия `findOne` без `companyId`-фильтра в `where` (только по `id`), потому что вызывается
из BullMQ-процессора (фоновый контекст без аутентифицированного пользователя/AsyncLocalStorage,
см. инвариант про company-scoping в [04_BACKEND_CORE.md](04_BACKEND_CORE.md) — он покрывает только запросы
внутри HTTP-контекста, фон должен сам решать, как себя ограничивать).

## BillingController

- `GET /billing/plans` — список тарифов с ценами/лимитами
- `GET /billing/networks` — список поддерживаемых сетей оплаты (`['TRC20','ERC20','BEP20']`)
- `GET /billing/current` — текущий план, баланс и использование лимитов компании
- `GET /billing/transactions` — леджер баланса (пополнения и списания/даунгрейды)
- `GET /billing/invoices` — все счета на пополнение баланса
- `POST /billing/topup` — создать счёт на пополнение `{ amount, network }`, вернуть адрес оплаты в выбранной сети
- `GET /billing/invoices/:id` — статус счёта (для поллинга на экране "ожидаем оплату")
- `POST /billing/invoices/:id/check` — принудительная проверка оплаты ("Я оплатил")
- `POST /billing/select-plan` — выбрать/сменить/продлить тариф `{ plan }`, списывает с баланса немедленно
  (400, если баланса не хватает — ничего не меняется, ни частичной, ни отложенной активации нет)
- `POST /billing/topup/heleket` — создать инвойс через Heleket `{ amount, network? }` (готовится к
  интеграции, см. ниже — без ключей в `.env` вернёт 500)
- `POST /billing/webhooks/heleket` — `@Public()`, вебхук от серверов Heleket (не от пользователя)

## Кроны

```typescript
// Подстраховка на случай потери BullMQ-job (например, после рестарта Redis) —
// основная проверка expiresAt уже встроена в checkPayment().
@Cron('*/5 * * * *')
async expireStaleInvoices() {
  const stale = await this.prisma.invoice.findMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
  });
  for (const invoice of stale) {
    await this.cryptoPayment.stopMonitoring(invoice.id);
    await this.prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'EXPIRED' } });
  }
}

// Каждые 15 минут — продление подписок списанием с баланса или даунгрейд до TRIAL.
@Cron('*/15 * * * *')
async renewSubscriptions() {
  await this.billingService.runRenewals();
}

// Каждые 15 минут — повтор свипа для PAID-инвойсов с sweepError != null и sweptAt == null
// (например, газовый кошелёк временно был пуст). Баланс клиента уже зачислен независимо от этого.
@Cron('*/15 * * * *')
async retrySweeps() {
  await this.billingService.retryFailedSweeps();
}
```

## Heleket — хостед-гейтвей (готовится к интеграции, не активен без ключей)

Принципиально другая модель, чем self-hosted TRC20/ERC20/BEP20: мы не держим приватных ключей и не
свипаем сами. Heleket (api.heleket.com) создаёт инвойс на своей стороне, сам мониторит блокчейн и
уведомляет нас вебхуком, когда платёж подтверждён; зачисленные средства оседают на меречант-балансе
Heleket, вывод оттуда — отдельная, не автоматизированная здесь операция. API сверен по официальной
документации doc.heleket.com (создание инвойса, формат и подпись вебхука) на 2026-06-27, не написан
по памяти/предположению — но **никогда не вызывался против настоящего Heleket-аккаунта**, потому что
в этой среде нет `HELEKET_MERCHANT_ID`/`HELEKET_API_KEY`. Перед реальным включением — хотя бы один
тест с реальными ключами в песочнице/проде, code review не заменяет живую проверку подписи.

```
POST /billing/topup/heleket {amount, network?}
        |
        v
BillingService.createHeleketTopUp()
        |  создаёт Invoice(provider=HELEKET, status=PENDING) — нужен ДО вызова Heleket,
        |  его id передаётся как order_id для последующего сопоставления вебхука
        v
HeleketGatewayProvider.createInvoice() — POST https://api.heleket.com/v1/payment
        |  заголовки merchant/sign; sign = md5(base64(json) + apiKey)
        v
Invoice.paymentAddress/network/gatewayUuid обновлены из ответа Heleket
        |
        v
(пользователь платит на странице/адресу Heleket — мы тут не участвуем)
        |
        v
POST /billing/webhooks/heleket  (от серверов Heleket, @Public(), без JWT)
        |
        v
BillingService.handleHeleketWebhook()
        |  verifyWebhookSignature() — ОБЯЗАТЕЛЬНО до доверия payload, иначе любой может
        |  подделать запрос "оплата прошла" и бесплатно пополнить себе баланс
        |
        +-- status != paid/paid_over --> игнорируем (промежуточные статусы)
        |
        +-- status == paid --> найти Invoice по id (= order_id), если status уже не
            PENDING — игнорируем (идемпотентность на случай повторного вебхука),
            иначе creditBalance() — тот же путь, что и self-hosted, БЕЗ stopMonitoring/sweep
            (provider != SELF_HOSTED — нет своего адреса/BullMQ-джобы)
```

**Подпись запроса и вебхука — одна и та же формула**: `md5(base64(json) + apiKey)`, где `json` — это
JSON с экранированными `/` как `\/` (PHP `json_encode`-стиль на стороне Heleket; обычный
`JSON.stringify` в Node этого не делает — расхождение в этой одной детали полностью ломает проверку
подписи в обе стороны). `HeleketGatewayProvider.toPhpJson()` — общий helper для запроса и вебхука.

**Что не сделано намеренно** (нет реальных ключей — ничего из этого нельзя проверить вживую):
- Нет UI-кнопки, реально создающей Heleket-инвойс — на `/billing` только задизейбленная
  "Heleket (скоро)". `POST /billing/topup/heleket` существует и работает, но возвращает понятную
  500-ошибку без `HELEKET_MERCHANT_ID`/`HELEKET_API_KEY` в `.env`.
- Нет вывода средств с меречант-баланса Heleket — это отдельный API (payout), не входит в этот шаг.
- Нет повторного запроса статуса инвойса (`GET .../payment/info`) — рассчитываем только на вебхук;
  стоит добавить как подстраховку (по аналогии с `expireStaleInvoices`), когда появятся ключи.
