import { IsIn, IsNumber, Min } from 'class-validator';
import { PAYMENT_NETWORKS, PaymentNetwork } from '../providers/payment-network.provider.interface';

const MIN_TOPUP_USDT = 10;

export class CreateTopUpDto {
  @IsNumber()
  @Min(MIN_TOPUP_USDT)
  amount: number;

  @IsIn(PAYMENT_NETWORKS)
  network: PaymentNetwork;
}
