import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectPersonalPhoneDto {
  // Формат — как принимает Telegram (+79991234567 и т.п.), без дополнительной валидации
  // формата: разные страны, разные длины, Telegram сам скажет, если номер некорректен.
  @IsString()
  @IsNotEmpty()
  phone: string;
}

export class ConnectPersonalCodeDto {
  @IsString()
  @IsNotEmpty()
  code: string;
}

export class ConnectPersonalPasswordDto {
  @IsString()
  @IsNotEmpty()
  password: string;
}
