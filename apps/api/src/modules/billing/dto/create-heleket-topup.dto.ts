import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

const MIN_TOPUP_USDT = 10;

export class CreateHeleketTopUpDto {
  @IsNumber()
  @Min(MIN_TOPUP_USDT)
  amount: number;

  // Опционально — конкретная сеть из набора, который поддерживает Heleket (шире, чем
  // наши TRC20/ERC20/BEP20); без неё Heleket даёт выбрать сеть на своей хостед-странице.
  @IsOptional()
  @IsString()
  network?: string;
}
