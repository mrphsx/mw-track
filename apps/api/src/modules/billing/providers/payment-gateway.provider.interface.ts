// Хостед-гейтвей (Heleket и подобные) принципиально другая модель, чем
// PaymentNetworkProvider: мы не держим приватных ключей и не свипаем сами —
// гейтвей создаёт инвойс на своей стороне и сам уведомляет нас вебхуком,
// когда платёж подтверждён. Поэтому отдельный интерфейс, не натягиваем на
// PaymentNetworkProvider только чтобы "было одинаково".
export interface GatewayInvoice {
  gatewayUuid: string;
  paymentAddress: string | null;
  paymentUrl: string | null; // хостед-страница оплаты гейтвея, если есть
  network: string | null;
}

export interface GatewayWebhookResult {
  gatewayUuid: string;
  orderId: string; // наш Invoice.id, переданный при создании
  isPaid: boolean;
  isFinal: boolean;
  paidAmount: number;
  txHash: string | null;
}

export interface PaymentGatewayProvider {
  createInvoice(orderId: string, amount: number, network?: string): Promise<GatewayInvoice>;
  verifyWebhookSignature(payload: Record<string, unknown>): boolean;
  parseWebhook(payload: Record<string, unknown>): GatewayWebhookResult;
}
