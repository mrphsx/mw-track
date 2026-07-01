import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TestMessageDto {
  @IsString()
  @IsNotEmpty()
  channelUserId: string;

  @IsOptional()
  @IsString()
  text?: string;
}
