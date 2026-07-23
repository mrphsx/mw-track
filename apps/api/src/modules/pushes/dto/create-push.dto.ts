import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { PushFilterDto } from '../../clients/dto/push-filter.dto';

class PushButtonDto {
  @IsString()
  text: string;

  @IsOptional()
  @IsString()
  url?: string;
}

export class PushMediaDto {
  // video_note — кружок (запрос пользователя 2026-07-17) — уже полностью поддержан
  // на уровне отправки (TelegramProvider.sendMessage), не хватало только здесь и в UI.
  @IsIn(['photo', 'video', 'video_note'])
  type: 'photo' | 'video' | 'video_note';

  @IsString()
  url: string;
}

export class CreatePushDto {
  @IsString()
  name: string;

  @IsString()
  messageText: string;

  // Альбом (Telegram media group, запрос пользователя 2026-07-17: "как загрузить больше
  // медиа в одну рассылку") — массив вместо одного объекта. 1 элемент = как раньше (одиночное
  // фото/видео/кружок), 2-10 элементов = альбом. Лимит 10 — ограничение самого Bot API
  // (sendMediaGroup принимает 2-10 элементов). video_note не может быть частью альбома
  // (Bot API это не поддерживает) — проверяется в PushesService, не здесь, т.к. правило
  // завязано на длину массива, а не на форму отдельного элемента.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PushMediaDto)
  messageMedia?: PushMediaDto[];

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
