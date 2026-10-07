import { IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { MAX_PURCHASE_AMOUNT_USD } from '../../../common/purchase-amount.const';

export class CreatePurchaseDto {
  // Верхняя граница — только физический предел колонки Decimal(10,2), бизнес-лимита нет
  // (см. purchase-amount.const.ts). Без неё слишком большое число доходило до Postgres и
  // возвращалось сырой 500-кой вместо понятного ответа.
  @IsNumber()
  @Min(0.01)
  @Max(MAX_PURCHASE_AMOUNT_USD, { message: `Сумма не может превышать ${MAX_PURCHASE_AMOUNT_USD}` })
  amount: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsIn(['manual', 'api', 'bot', 'webhook'])
  source?: 'manual' | 'api' | 'bot' | 'webhook';
}
