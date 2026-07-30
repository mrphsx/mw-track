import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Permission } from '@prisma/client';
import { CREATABLE_ROLES, CreatableRole, ProjectPermissionsDto } from './create-team-member.dto';

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsIn(CREATABLE_ROLES)
  role?: CreatableRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Полная замена набора проектов (не патч) — проще и надёжнее диффа существующих
  // ProjectAccess, см. TeamService.update. Актуально только для BUYER/OPERATOR.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
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
}
