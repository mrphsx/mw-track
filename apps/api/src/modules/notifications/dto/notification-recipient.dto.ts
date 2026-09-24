import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { NOTIFICATION_TYPES } from '../notification-types';

export class CreateNotificationRecipientDto {
  @IsString()
  @MaxLength(64)
  username!: string;

  // Не передан — получатель подписывается на все типы сразу (самое частое желание при добавлении).
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFICATION_TYPES, { each: true })
  enabledTypes?: string[];
}

export class UpdateNotificationRecipientDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFICATION_TYPES, { each: true })
  enabledTypes!: string[];
}
