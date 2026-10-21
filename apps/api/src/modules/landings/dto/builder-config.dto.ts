import { IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

// Конструктор лендингов — см. builder.util.ts. Настроек много и они вложенные, поэтому DTO
// принимает объект целиком, а сервер приводит его к допустимым значениям сам
// (resolveBuilderConfig) и возвращает понятную ошибку на явно неверные данные
// (validateBuilderConfig). Ключ фото фона из запроса не принимается — его ставит только загрузка.

// Живое превью в редакторе: конфиг ещё не сохранён, фото и аватар могут быть blob:-адресами.
export class BuilderPreviewDto {
  @IsObject() config: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(2000) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) avatarUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) channelTitle?: string;
  @IsOptional() @IsString() @MaxLength(40) subscribersCount?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20) startScreen?: number;
}
