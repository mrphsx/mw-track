import { ArrayMinSize, IsArray, IsEnum, IsIn, IsEmail, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ClientsVisibilityScope, LandingsVisibilityScope, Permission } from '@prisma/client';

// role=OWNER не входит в допустимые значения намеренно — смена/создание второго Owner не
// поддерживается в Фазе 1 (см. память/15_PHASES.md, "Team/роли Фаза 1"). OPERATOR_ADMIN — новая
// роль (запрос пользователя 2026-07-30), project-scoped как BUYER/OPERATOR — projectIds для неё
// обязателен по той же причине (см. TeamService.create).
export const CREATABLE_ROLES = ['ADMIN', 'BUYER', 'OPERATOR', 'OPERATOR_ADMIN'] as const;
export type CreatableRole = (typeof CREATABLE_ROLES)[number];

// Разрешения на ОДНОМ конкретном проекте (запрос пользователя 2026-07-28: "чтобы под каждый
// проект можно было выбрать разрешения, а не общие") — раньше `permissions: Permission[]` был
// один общий список, действующий на все `projectIds` пользователя сразу.
export class ProjectPermissionsDto {
  @IsString()
  projectId: string;

  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions: Permission[];
}

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

  // Разрешения ПО КАЖДОМУ проекту из projectIds — запрос пользователя 2026-07-28. Не обязан
  // покрывать все projectIds: для тех, что не указаны здесь явно, сервис засеет дефолт по роли
  // (DEFAULT_ROLE_PERMISSIONS), как и раньше при полном отсутствии permissions. Для ADMIN
  // игнорируется (elevated, всегда полный доступ).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectPermissionsDto)
  projectPermissions?: ProjectPermissionsDto[];

  // DOMAINS_* — единственное исключение из per-project модели (решение пользователя: домены не
  // привязаны к одному проекту). Отдельный плоский список вместо привязки к конкретному
  // projectId — сервис применяет его одинаково на КАЖДЫЙ из projectIds (для существующей
  // hasAnyProjectPermission-проверки достаточно, чтобы право лежало хотя бы на одном).
  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  domainsPermissions?: Permission[];

  // Область видимости company-wide списка лендингов (запрос пользователя 2026-08-03) — актуально
  // только для BUYER/OPERATOR (ADMIN/OPERATOR_ADMIN не гейтятся этим полем); дефолт при отсутствии
  // — PROJECT_LANDINGS (см. схему), так что поле необязательно даже для этих ролей.
  @IsOptional()
  @IsEnum(LandingsVisibilityScope)
  landingsVisibilityScope?: LandingsVisibilityScope;

  // "Только свои клиенты" (запрос пользователя 2026-08-03) — переключатель по каждому Buyer'у
  // отдельно (подтверждено AskUserQuestion), актуально только для роли BUYER. Дефолт при
  // отсутствии — ALL_CLIENTS (см. схему), текущее поведение не меняется молча.
  @IsOptional()
  @IsEnum(ClientsVisibilityScope)
  clientsVisibilityScope?: ClientsVisibilityScope;
}
