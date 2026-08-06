import { IsIn, IsNumber, Min } from 'class-validator';
import { PAYMENT_NETWORKS, PaymentNetwork } from '../providers/payment-network.provider.interface';

const MIN_TOPUP_USDT = 10;

export class CreateNowPaymentsTopUpDto {
  @IsNumber()
  @Min(MIN_TOPUP_USDT)
  amount: number;

  // NOWPayments требует конкретную монету при создании платежа через /v1/payment (в отличие
  // от Heleket, где сеть опциональна) — переиспользуем те же 3 сети, что и у self-hosted.
  @IsIn(PAYMENT_NETWORKS)
  network: PaymentNetwork;
}
