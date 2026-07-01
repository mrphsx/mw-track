export interface PaymentMatch {
  txHash: string;
  amount: number;
}

export interface SweepResult {
  txHash: string;
}

// Один интерфейс на сеть оплаты — то же решение, что и для ChannelProvider/PixelProvider:
// добавить новую сеть = новая конфигурация существующего провайдера или новый класс,
// без if/else в BillingService/CryptoPaymentService.
export interface PaymentNetworkProvider {
  generateAddress(invoiceId: string): string;
  checkTransaction(address: string, expectedAmount: number): Promise<PaymentMatch | null>;
  sweepToOwner(invoiceId: string, address: string, amount: number): Promise<SweepResult>;
}

export const PAYMENT_NETWORKS = ['TRC20', 'ERC20', 'BEP20'] as const;
export type PaymentNetwork = (typeof PAYMENT_NETWORKS)[number];
