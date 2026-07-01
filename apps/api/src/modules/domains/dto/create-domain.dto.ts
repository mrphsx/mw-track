import { IsOptional, IsString, Matches } from 'class-validator';

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
}
