import { ArrayMinSize, IsArray, IsEmail, IsEnum, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Permission } from '@prisma/client';

// role=OWNER не входит в допустимые значения намеренно — смена/создание второго Owner не
// поддерживается в Фазе 1 (см. память/15_PHASES.md, "Team/роли Фаза 1").
export const CREATABLE_ROLES = ['ADMIN', 'BUYER', 'OPERATOR'] as const;
export type CreatableRole = (typeof CREATABLE_ROLES)[number];

export class CreateTeamMemberDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsIn(CREATABLE_ROLES)
  role: CreatableRole;

  // Обязателен и непуст для BUYER/OPERATOR (проверяется в сервисе — человек без единого
  // назначенного проекта не сможет ничего увидеть, почти наверняка ошибка). Для ADMIN
  // игнорируется — у Admin доступ ко всем проектам компании без ProjectAccess.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  projectIds?: string[];

  // Гранулярные права (запрос пользователя 2026-07-17) — для ADMIN игнорируется (elevated,
  // всегда полный доступ). Для BUYER/OPERATOR: если не передано вовсе — сервис засеет дефолт
  // по роли (DEFAULT_ROLE_PERMISSIONS), см. TeamService.create/seedDefaultsIfEmpty.
  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions?: Permission[];
}
