import { IsObject, IsOptional } from 'class-validator';

// config = null — сбросить воронку к поведению по умолчанию. Содержимое проверяет
// parseFunnelConfigInput (common/funnel-config.ts), здесь — только что это объект.
export class UpdateFunnelDto {
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown> | null;
}
