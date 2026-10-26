import { IsEnum } from 'class-validator';
import { TelegramMode } from '@prisma/client';

export class SwitchEntryDto {
  @IsEnum(TelegramMode)
  mode!: TelegramMode;
}
