import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ChannelType, TelegramMode } from '@prisma/client';

export class CreateChannelDto {
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsEnum(ChannelType)
  type: ChannelType;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  tgBotToken?: string;

  @IsOptional()
  @IsString()
  tgChannelId?: string;

  @IsOptional()
  @IsString()
  tgChannelUsername?: string;

  @IsOptional()
  @IsString()
  tgWelcomeMessage?: string;

  // 4 способа, которыми лендинг ведёт в Telegram — см. prisma/schema.prisma enum TelegramMode.
  @IsOptional()
  @IsEnum(TelegramMode)
  tgMode?: TelegramMode;

  // Только для tgMode=PERSONAL_DM — личный @username, без бота вообще.
  @IsOptional()
  @IsString()
  tgPersonalUsername?: string;

  @IsOptional()
  @IsString()
  wa360Token?: string;

  @IsOptional()
  @IsString()
  igPageId?: string;

  @IsOptional()
  @IsString()
  igAccessToken?: string;
}
