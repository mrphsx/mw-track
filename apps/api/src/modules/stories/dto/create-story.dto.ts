import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

// multipart/form-data — файл приходит отдельно через @UploadedFile(), эти поля идут строками
// в теле формы вместе с ним (тот же приём, что и mediaType у PushMediaController.upload).
export class CreateStoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048) // тот же лимит подписи, что Telegram Stories принимает у себя
  caption?: string;

  // Пусто/не передано = опубликовать как можно скорее (следующий тик StoriesCron).
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
