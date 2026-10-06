import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

// Базовый формат хоста (без протокола/пути) — допускает поддомены, без подсказки на www.
const DOMAIN_REGEX = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export class CreateDomainDto {
  @IsString()
  @Matches(DOMAIN_REGEX, { message: 'Некорректный формат домена' })
  domain: string;

  // Не влияет ни на что в подключении путей — лендинги любого проекта компании можно привязать
  // к любому пути на домене (см. DomainPath); это поле осталось чисто для группировки в UI.
  @IsOptional()
  @IsString()
  projectId?: string;

  // Кому из не-админских ролей доступен домен (запрос пользователя 2026-10-06). Отсутствие
  // обоих полей = домен достаётся только Owner/Admin, пока доступ не выдадут явно — для НОВЫХ
  // доменов это и есть смысл запроса ("админ добавляет домен и выбирает кому он доступен");
  // уже существующие домены остаются общими за счёт @default(true) в схеме, их этот путь не
  // касается.
  @IsOptional()
  @IsBoolean()
  sharedWithAllBuyers?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  allowedUserIds?: string[];
}
