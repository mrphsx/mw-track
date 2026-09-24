import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Альтернатива ZIP-загрузке white page (запрос пользователя 2026-09-23: "просто сразу код
// кидать в поле") — весь HTML одним текстовым блоком, без отдельных файлов-ассетов. MaxLength
// подобран под поднятый в main.ts лимит JSON body (5mb) с запасом на накладные расходы самого
// JSON-конверта.
export class UploadPrelandingHtmlDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4_000_000)
  html: string;
}
