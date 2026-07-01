import { IsNotEmpty, IsString } from 'class-validator';

export class UpsertDomainPathDto {
  // Нормализуется в DomainsService.normalizeDomainPath (ведущий слеш, без конечного, кроме "/").
  @IsString()
  @IsNotEmpty()
  path: string;

  @IsString()
  @IsNotEmpty()
  landingId: string;
}
