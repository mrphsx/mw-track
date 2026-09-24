import { IsString, MaxLength, MinLength } from 'class-validator';

export class ConnectNotificationBotDto {
  @IsString()
  @MinLength(30)
  @MaxLength(100)
  token!: string;
}
