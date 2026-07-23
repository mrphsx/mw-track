import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Ровно одно из landingId/abTestGroupId (запрос пользователя 2026-07-17) — валидируется в
// DomainsService.upsertPath, не здесь (нужен доступ к обоим полям сразу, class-validator'у
// такое сравнение неудобно выражать декоратором).
export class UpsertDomainPathDto {
  // Нормализуется в DomainsService.normalizeDomainPath (ведущий слеш, без конечного, кроме "/").
  @IsString()
  @IsNotEmpty()
  path: string;

  @IsOptional()
  @IsString()
  landingId?: string;

  @IsOptional()
  @IsString()
  abTestGroupId?: string;
}
