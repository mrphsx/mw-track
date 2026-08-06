import { IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ClientsVisibilityScope, LandingsVisibilityScope, Permission } from '@prisma/client';
import { CREATABLE_ROLES, CreatableRole, ProjectPermissionsDto } from './create-team-member.dto';

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsIn(CREATABLE_ROLES)
  role?: CreatableRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Полная замена набора проектов (не патч) — проще и надёжнее диффа существующих
  // ProjectAccess, см. TeamService.update. НЕ `@ArrayMinSize(1)` (снято 2026-07-31, запрос
  // пользователя: "должна быть возможность убрать все проекты у оператора") — Operator
  // единственная роль, для которой пустой массив легитимен (снятие со всех проектов сразу);
  // минимум в один проект для Buyer/Оператор-админ теперь проверяется явно в
  // TeamService.update (см. её комментарий), а не декоратором, который бы запретил пустой
  // массив безусловно для всех ролей.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  projectIds?: string[];

  // Полная замена прав НА КАЖДОМ проекте из projectIds (не патч) — запрос пользователя
  // 2026-07-28, см. TeamService.update/PermissionsService.replacePermissionsForProject.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectPermissionsDto)
  projectPermissions?: ProjectPermissionsDto[];

  // DOMAINS_* — общие права роли, не per-project (решение пользователя), см. комментарий в
  // CreateTeamMemberDto.
  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  domainsPermissions?: Permission[];

  // См. комментарий в CreateTeamMemberDto.
  @IsOptional()
  @IsEnum(LandingsVisibilityScope)
  landingsVisibilityScope?: LandingsVisibilityScope;

  // См. комментарий в CreateTeamMemberDto.
  @IsOptional()
  @IsEnum(ClientsVisibilityScope)
  clientsVisibilityScope?: ClientsVisibilityScope;

  // Редактирование данных сотрудника после создания (запрос пользователя 2026-08-03:
  // "иметь возможность редактировать всю информацию... возможность менять пароль") — раньше
  // этот эндпоинт трогал только роль/проекты/права, базовые данные учётки менялись только через
  // прямую запись в БД. Уникальность email проверяется в TeamService.update (тот же паттерн,
  // что и при создании). password — если передан, перехеширован заново; пустое/отсутствующее
  // поле НЕ означает "сбросить пароль" (в отличие от некоторых полей формы редактирования
  // канала), это осознанно необязательное поле именно смены пароля.
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @MinLength(8)
  password?: string;
}
