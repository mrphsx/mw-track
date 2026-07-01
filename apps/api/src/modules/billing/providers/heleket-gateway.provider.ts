import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import { GatewayInvoice, GatewayWebhookResult, PaymentGatewayProvider } from './payment-gateway.provider.interface';

export interface HeleketProviderConfig {
  apiUrl: string; // https://api.heleket.com/v1
  merchantId?: string;
  apiKey?: string;
  callbackUrl: string; // наш публичный POST /billing/webhooks/heleket
}

// Heleket — хостед-крипто-гейтвей (api.heleket.com): мы не держим ключей и не свипаем,
// они сами мониторят блокчейн и шлют вебхук на url_callback. Готовится к интеграции
// (нет реального HELEKET_MERCHANT_ID/HELEKET_API_KEY в этой среде) — см. 10_BACKEND_BILLING.md.
// API сверен по официальной документации doc.heleket.com на 2026-06-27 (создание инвойса,
// формат вебхука, формула подписи) — не код по памяти/предположению.
export class HeleketGatewayProvider implements PaymentGatewayProvider {
  private readonly logger = new Logger(HeleketGatewayProvider.name);

  constructor(private readonly config: HeleketProviderConfig) {}

  // PHP's json_encode (на стороне Heleket) экранирует "/" как "\/" — JS JSON.stringify
  // этого не делает. Если не повторить экранирование и здесь, и при верификации вебхука,
  // подпись запроса/вебхука не совпадёт с тем, что считает Heleket, в любую сторону.
  private toPhpJson(value: unknown): string {
    return JSON.stringify(value).replace(/\//g, '\\/');
  }

  private sign(json: string): string {
    if (!this.config.apiKey) throw new Error('HELEKET_API_KEY не задан в .env');
    const base64 = Buffer.from(json, 'utf-8').toString('base64');
    return crypto.createHash('md5').update(base64 + this.config.apiKey).digest('hex');
  }

  async createInvoice(orderId: string, amount: number, network?: string): Promise<GatewayInvoice> {
    if (!this.config.merchantId || !this.config.apiKey) {
      throw new Error('HELEKET_MERCHANT_ID/HELEKET_API_KEY не настроены — Heleket недоступен');
    }

    const body: Record<string, unknown> = {
      amount: amount.toFixed(2),
      currency: 'USDT',
      order_id: orderId,
      url_callback: this.config.callbackUrl,
      lifetime: 1800, // 30 минут — как и у self-hosted инвойсов
    };
    if (network) body.network = network;

    const json = this.toPhpJson(body);
    const sign = this.sign(json);

    let res: Response;
    try {
      res = await fetch(`${this.config.apiUrl}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', merchant: this.config.merchantId, sign },
        body: json,
      });
    } catch (error) {
      throw new Error(`Heleket недоступен: ${(error as Error).message}`);
    }

    const data = (await res.json()) as { state: number; result?: Record<string, unknown>; message?: string };
    if (!res.ok || data.state !== 0 || !data.result) {
      throw new Error(`Heleket отказал в создании инвойса: ${data.message || res.status}`);
    }

    return {
      gatewayUuid: String(data.result.uuid),
      paymentAddress: (data.result.address as string) ?? null,
      paymentUrl: (data.result.url as string) ?? null,
      network: (data.result.network as string) ?? null,
    };
  }

  // См. doc.heleket.com/methods/payments/webhook: подпись = md5(base64(json_без_sign) + apiKey)
  verifyWebhookSignature(payload: Record<string, unknown>): boolean {
    if (!this.config.apiKey) return false;
    const { sign, ...rest } = payload;
    if (typeof sign !== 'string') return false;
    const expected = this.sign(this.toPhpJson(rest));
    return expected === sign;
  }

  parseWebhook(payload: Record<string, unknown>): GatewayWebhookResult {
    const status = String(payload.status ?? '');
    return {
      gatewayUuid: String(payload.uuid ?? ''),
      orderId: String(payload.order_id ?? ''),
      isPaid: status === 'paid' || status === 'paid_over',
      isFinal: Boolean(payload.is_final),
      paidAmount: Number(payload.payment_amount ?? 0),
      txHash: (payload.txid as string) ?? null,
    };
  }
}
