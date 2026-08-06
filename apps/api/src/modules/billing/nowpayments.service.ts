import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NowPaymentsGatewayProvider } from './providers/nowpayments-gateway.provider';
import { GatewayInvoice, GatewayWebhookResult } from './providers/payment-gateway.provider.interface';

// Тонкая обёртка вокруг NowPaymentsGatewayProvider — тот же приём, что HeleketService
// делает для HeleketGatewayProvider (резолвит конфиг через ConfigService).
@Injectable()
export class NowPaymentsService {
  private readonly provider: NowPaymentsGatewayProvider;

  constructor(private config: ConfigService) {
    const apiUrl = this.config.get<string>('API_URL') || 'http://localhost:3001';
    this.provider = new NowPaymentsGatewayProvider({
      apiUrl: this.config.get<string>('NOWPAYMENTS_API_URL') || 'https://api.nowpayments.io/v1',
      apiKey: this.config.get<string>('NOWPAYMENTS_API_KEY'),
      ipnSecret: this.config.get<string>('NOWPAYMENTS_IPN_SECRET'),
      callbackUrl: `${apiUrl}/api/v1/billing/webhooks/nowpayments`,
    });
  }

  createInvoice(orderId: string, amount: number, network?: string): Promise<GatewayInvoice> {
    return this.provider.createInvoice(orderId, amount, network);
  }

  verifyWebhookSignature(payload: Record<string, unknown>): boolean {
    return this.provider.verifyWebhookSignature(payload);
  }

  parseWebhook(payload: Record<string, unknown>): GatewayWebhookResult {
    return this.provider.parseWebhook(payload);
  }
}
