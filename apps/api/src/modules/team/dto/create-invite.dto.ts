import { ArrayMinSize, IsArray, IsEnum, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ClientsVisibilityScope, LandingsVisibilityScope, Permission } from '@prisma/client';
import { CREATABLE_ROLES, CreatableRole, ProjectPermissionsDto } from './create-team-member.dto';

export class CreateInviteDto {
  @IsIn(CREATABLE_ROLES)
  role: CreatableRole;

  // Обязателен и непуст для BUYER/OPERATOR, игнорируется для ADMIN — та же проверка, что и
  // в CreateTeamMemberDto (см. TeamInvitesService.create).
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  projectIds?: string[];

  // Как в CreateTeamMemberDto — если не передано, TeamInvitesService.accept засеет дефолт по
  // роли при создании пользователя (запрос пользователя 2026-07-28, per-project права).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectPermissionsDto)
  projectPermissions?: ProjectPermissionsDto[];

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
}
