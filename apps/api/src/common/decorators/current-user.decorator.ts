import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Permission, UserRole } from '@prisma/client';

// Форма request.user, которую кладёт JwtStrategy.validate() — общий тип, чтобы не дублировать
// один и тот же локальный интерфейс в каждом контроллере (было в ProjectsController).
export interface AuthUser {
  userId: string;
  companyId: string;
  role: UserRole;
  // Гранулярные права (запрос пользователя 2026-07-17) — пусто для elevated ролей
  // (OWNER/ADMIN/SUPER_ADMIN, см. PermissionsGuard/isElevatedRole), реальный список для
  // BUYER/OPERATOR. Приходит из JWT payload, см. AuthService.issueTokens.
  permissions: Permission[];
}

// @CurrentUser() — получить request.user (userId, companyId, role из JWT payload)
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
