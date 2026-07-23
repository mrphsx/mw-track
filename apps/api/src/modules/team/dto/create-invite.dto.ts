import { ArrayMinSize, IsArray, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { Permission } from '@prisma/client';
import { CREATABLE_ROLES, CreatableRole } from './create-team-member.dto';

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
  // роли при создании пользователя.
  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions?: Permission[];
}
