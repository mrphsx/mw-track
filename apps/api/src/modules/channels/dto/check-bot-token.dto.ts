import { IsString, MaxLength } from 'class-validator';

export class CheckBotTokenDto {
  @IsString()
  @MaxLength(200)
  token!: string;
}
