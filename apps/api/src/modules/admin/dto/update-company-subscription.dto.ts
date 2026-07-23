import { SubscriptionPlan } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, ValidateIf } from 'class-validator';

export class UpdateCompanySubscriptionDto {
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan;

  // string | null | undefined — null снимает автопродление (как у TRIAL/ENTERPRISE сейчас),
  // undefined оставляет planExpiresAt как есть. Тот же трёхзначный паттерн, что и
  // UpdatePushDto.scheduledAt — просто @IsOptional() без @ValidateIf не пропускает null через
  // @IsDateString (уже наступали на эти грабли в Фазе 1.8, см. память).
  @IsOptional()
  @ValidateIf((o) => o.planExpiresAt !== null)
  @IsDateString()
  planExpiresAt?: string | null;
}
