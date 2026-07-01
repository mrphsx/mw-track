import { IsString } from 'class-validator';

// multipart/form-data: имя приходит текстовым полем рядом с файлом, поэтому это не JSON body.
export class UploadCustomLandingDto {
  @IsString()
  name: string;
}
