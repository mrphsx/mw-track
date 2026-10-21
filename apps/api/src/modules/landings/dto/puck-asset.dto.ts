import { IsOptional, IsString, MaxLength } from 'class-validator';

// Загрузка картинки визуального редактора: projectId — для ещё не созданного лендинга,
// landingId — для существующего (тогда проверяется право изменять именно его).
export class PuckAssetUploadDto {
  @IsOptional() @IsString() @MaxLength(40) projectId?: string;
  @IsOptional() @IsString() @MaxLength(40) landingId?: string;
}
