import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Объявление из панели администрирования (запрос пользователя 2026-10-02). companyIds пустой или
// отсутствует = "всем компаниям" (включая будущие) — отдельного флага toAll нет специально,
// чтобы не было состояния "toAll: true и при этом выбраны компании".
export class CreateAdminNoticeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  companyIds?: string[];
}
