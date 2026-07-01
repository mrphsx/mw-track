import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HeleketGatewayProvider } from './providers/heleket-gateway.provider';
import { GatewayInvoice, GatewayWebhookResult } from './providers/payment-gateway.provider.interface';

// Тонкая обёртка вокруг HeleketGatewayProvider — резолвит конфиг через ConfigService,
// тот же приём, что CryptoPaymentService делает для TronUsdtProvider/EvmUsdtProvider.
@Injectable()
export class HeleketService {
  private readonly provider: HeleketGatewayProvider;

  constructor(private config: ConfigService) {
    const apiUrl = this.config.get<string>('API_URL') || 'http://localhost:3001';
    this.provider = new HeleketGatewayProvider({
      apiUrl: this.config.get<string>('HELEKET_API_URL') || 'https://api.heleket.com/v1',
      merchantId: this.config.get<string>('HELEKET_MERCHANT_ID'),
      apiKey: this.config.get<string>('HELEKET_API_KEY'),
      callbackUrl: `${apiUrl}/api/v1/billing/webhooks/heleket`,
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
