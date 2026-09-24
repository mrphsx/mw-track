import { IsNotEmpty, IsString } from 'class-validator';

export class ExchangeImpersonationCodeDto {
  @IsString()
  @IsNotEmpty()
  code: string;
}
