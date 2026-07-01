import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { PushFilterDto } from '../../clients/dto/push-filter.dto';

class PushButtonDto {
  @IsString()
  text: string;

  @IsOptional()
  @IsString()
  url?: string;
}

class PushMediaDto {
  @IsIn(['photo', 'video'])
  type: 'photo' | 'video';

  @IsString()
  url: string;
}

export class CreatePushDto {
  @IsString()
  name: string;

  @IsString()
  messageText: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PushMediaDto)
  messageMedia?: PushMediaDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PushButtonDto)
  buttons?: PushButtonDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => PushFilterDto)
  filter: PushFilterDto;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
