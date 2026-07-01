import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePurchaseDto {
  @IsNumber()
  @Min(0.01)
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
