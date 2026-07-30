import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';

// Форма request.user, которую кладёт JwtStrategy.validate() — общий тип, чтобы не дублировать
// один и тот же локальный интерфейс в каждом контроллере (было в ProjectsController).
// Права (запрос пользователя 2026-07-28, per-project редизайн) больше не приходят из JWT —
// проверяются DB-backed через ProjectsService.assertAccess/PermissionsService.hasPermission,
// см. permissions.service.ts.
export interface AuthUser {
  userId: string;
  companyId: string;
  role: UserRole;
}

// @CurrentUser() — получить request.user (userId, companyId, role из JWT payload)
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
