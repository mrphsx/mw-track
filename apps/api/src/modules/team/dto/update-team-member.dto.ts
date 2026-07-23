import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { Permission } from '@prisma/client';
import { CREATABLE_ROLES, CreatableRole } from './create-team-member.dto';

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

  // Полная замена набора прав (не патч), тот же принцип, что projectIds выше — см.
  // TeamService.update/PermissionsService.replacePermissions.
  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions?: Permission[];
}
