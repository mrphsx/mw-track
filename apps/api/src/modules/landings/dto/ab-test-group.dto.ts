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

export class CreateAbTestGroupDto {
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

// Запрос пользователя 2026-08-20: "после создания группы лэндингов для тестирования, уже
// нельзя будет их менять, так как статистика будет неверной" — состав/веса теста фиксируются
// один раз при создании (CreateAbTestGroupDto выше) и больше не редактируются: изменение
// участников/весов задним числом делает сравнение вариантов нечестным (по объёму собранных
// данных), тот же класс проблемы, что и прежний баг с "какой лендинг когда присоединился" (см.
// LandingsService.computeAbTestGroupMemberStats). Единственное, что остаётся редактируемым
// после создания, — название теста (не влияет на статистику).
export class UpdateAbTestGroupDto {
  @IsOptional()
  @IsString()
  name?: string;
}
