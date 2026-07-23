import { IsIn } from 'class-validator';

export const WELCOME_MEDIA_TYPES = ['PHOTO', 'VIDEO', 'VIDEO_NOTE', 'VOICE', 'DOCUMENT'] as const;
export type WelcomeMediaType = (typeof WELCOME_MEDIA_TYPES)[number];

// multipart/form-data — файл приходит отдельным полем (см. FileInterceptor в контроллере),
// mediaType приходит текстовым полем рядом с ним, как и UploadCustomLandingDto.name.
export class UploadWelcomeMediaDto {
  @IsIn(WELCOME_MEDIA_TYPES)
  mediaType: WelcomeMediaType;
}
