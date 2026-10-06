import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

// Кому доступен конкретный домен (запрос пользователя 2026-10-06). sharedWithAllBuyers: true —
// всем баерам компании, включая будущих; тогда allowedUserIds игнорируется (точечные гранты
// всё равно стираются, чтобы не осталось скрытого состояния, которое "всплывёт" при обратном
// переключении).
export class UpdateDomainAccessDto {
  @IsOptional()
  @IsBoolean()
  sharedWithAllBuyers?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  allowedUserIds?: string[];
}
