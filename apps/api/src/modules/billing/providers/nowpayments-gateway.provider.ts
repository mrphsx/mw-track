import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import { GatewayInvoice, GatewayWebhookResult, PaymentGatewayProvider } from './payment-gateway.provider.interface';

export interface NowPaymentsProviderConfig {
  apiUrl: string; // https://api.nowpayments.io/v1
  apiKey?: string;
  ipnSecret?: string;
  callbackUrl: string; // наш публичный POST /billing/webhooks/nowpayments
}

// Наши внутренние коды сети (TRC20/ERC20/BEP20, см. payment-network.provider.interface.ts)
// на pay_currency-коды NOWPayments — их API https://v1/payment требует конкретную монету,
// в отличие от /v1/invoice (хостед-страница с выбором сети), которую мы не используем, чтобы
// не тащить в PaymentModal новый flow с редиректом — вместо этого /v1/payment сразу отдаёт
// pay_address, как и HeleketGatewayProvider/self-hosted провайдеры, без изменений на фронте.
const NETWORK_TO_PAY_CURRENCY: Record<string, string> = {
  TRC20: 'usdttrc20',
  ERC20: 'usdterc20',
  BEP20: 'usdtbsc',
};

// NOWPayments (nowpayments.io) — хостед-крипто-гейтвей, подключён 2026-07-30 по реальным
// ключам пользователя. Как и Heleket: мы не держим приватных ключей и не свипаем сами —
// NOWPayments сам мониторит блокчейн и шлёт IPN-вебхук на ipn_callback_url. API сверен по
// официальной документации documenter.getpostman.com/view/7907941 (создание платежа,
// формат IPN, формула подписи) на момент написания.
export class NowPaymentsGatewayProvider implements PaymentGatewayProvider {
  private readonly logger = new Logger(NowPaymentsGatewayProvider.name);

  constructor(private readonly config: NowPaymentsProviderConfig) {}

  async createInvoice(orderId: string, amount: number, network?: string): Promise<GatewayInvoice> {
    if (!this.config.apiKey) {
      throw new Error('NOWPAYMENTS_API_KEY не настроен — NOWPayments недоступен');
    }

    const payCurrency = NETWORK_TO_PAY_CURRENCY[network ?? 'TRC20'];
    if (!payCurrency) {
      throw new Error(`NOWPayments: неизвестная сеть ${network}`);
    }

    const body = {
      price_amount: amount,
      price_currency: 'usd',
      pay_currency: payCurrency,
      order_id: orderId,
      order_description: `MWTRACK top-up ${orderId}`,
      ipn_callback_url: this.config.callbackUrl,
    };

    let res: Response;
    try {
      res = await fetch(`${this.config.apiUrl}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.config.apiKey },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`NOWPayments недоступен: ${(error as Error).message}`);
    }

    const data = (await res.json()) as {
      payment_id?: string | number;
      pay_address?: string;
      pay_currency?: string;
      message?: string;
    };
    if (!res.ok || !data.payment_id || !data.pay_address) {
      this.logger.error(`NOWPayments createInvoice failed: ${JSON.stringify(data)}`);
      throw new Error(`NOWPayments отказал в создании платежа: ${data.message || res.status}`);
    }

    return {
      gatewayUuid: String(data.payment_id),
      paymentAddress: data.pay_address,
      paymentUrl: null, // используем /v1/payment (прямой адрес), не хостед /v1/invoice
      network: network ?? null,
    };
  }

  // См. https://documenter.getpostman.com/view/7907941 "Instant Payments Notifications" —
  // подпись = HMAC-SHA512(JSON.stringify(sortKeysDeep(payload)), IPN_SECRET), hex,
  // сравнивается с заголовком x-nowpayments-sig. Ключи сортируются рекурсивно на всех
  // уровнях объекта — NOWPayments формирует подпись именно так на своей стороне.
  private sortKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((v) => this.sortKeysDeep(v));
    if (value && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = this.sortKeysDeep((value as Record<string, unknown>)[key]);
          return acc;
        }, {});
    }
    return value;
  }

  verifyWebhookSignature(payload: Record<string, unknown>): boolean {
    if (!this.config.ipnSecret) return false;
    const { 'x-nowpayments-sig': sig, ...rest } = payload as Record<string, unknown> & { 'x-nowpayments-sig'?: string };
    if (typeof sig !== 'string') return false;
    const sorted = JSON.stringify(this.sortKeysDeep(rest));
    const expected = crypto.createHmac('sha512', this.config.ipnSecret).update(sorted).digest('hex');
    return expected === sig;
  }

  parseWebhook(payload: Record<string, unknown>): GatewayWebhookResult {
    const status = String(payload.payment_status ?? '');
    return {
      gatewayUuid: String(payload.payment_id ?? ''),
      orderId: String(payload.order_id ?? ''),
      isPaid: status === 'confirmed' || status === 'finished',
      isFinal: status === 'finished',
      paidAmount: Number(payload.actually_paid ?? payload.pay_amount ?? 0),
      txHash: null, // NOWPayments не отдаёт txid входящей транзакции в IPN-пейлоаде
    };
  }
}
