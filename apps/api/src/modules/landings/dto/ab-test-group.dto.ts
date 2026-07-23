import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class AbTestMemberDto {
  @IsString()
  landingId: string;

  // Сумма weight по всем участникам группы должна быть ровно 100 — проверяется в
  // LandingsService.assertValidMembers (класс-валидатор не умеет "сумма полей массива").
  @IsInt()
  @Min(1)
  @Max(99)
  weight: number;
}

export class UpsertAbTestGroupDto {
  // Необязательное название теста (запрос пользователя 2026-07-17) — если не задано, фронтенд
  // показывает автосгенерированную подпись из имён участников.
  @IsOptional()
  @IsString()
  name?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => AbTestMemberDto)
  members: AbTestMemberDto[];
}
