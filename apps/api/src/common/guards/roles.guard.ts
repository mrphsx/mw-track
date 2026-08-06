import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

// ADMIN намеренно на одном уровне с OWNER (запрос пользователя 2026-07-04, Team/роли,
// Фаза 1) — Admin управляет проектами/командой наравне с Owner, разница только в биллинге/
// удалении компании, которая НЕ выражается рангом здесь — те места проверяют role напрямую
// (см. BillingController/TeamController), а не через @Roles()/эту иерархию.
// BUYER/OPERATOR — оба на низшем уровне, не иерархия друг над другом, а разные наборы
// доступных ресурсов (различаются explicit-проверкой role в конкретных контроллерах, не
// рангом) — см. ту же причину в комментарии выше.
const roleHierarchy: Record<UserRole, number> = {
  SUPER_ADMIN: 5,
  OWNER: 4,
  ADMIN: 4,
  BUYER: 1,
  OPERATOR: 1,
  // Тот же уровень, что BUYER/OPERATOR (project-scoped, не elevated, см.
  // permission.constants.ts RESTRICTED_ROLES) — доступ к /team даётся НЕ через этот ранг
  // (иначе Math.min(...) в canActivate ниже тихо впустил бы и BUYER/OPERATOR), а явной
  // проверкой роли в TeamService/TeamInvitesService, см. team-role.util.ts.
  OPERATOR_ADMIN: 1,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    const userLevel = roleHierarchy[user.role as UserRole] || 0;
    const requiredLevel = Math.min(...requiredRoles.map((r) => roleHierarchy[r] || 0));

    return userLevel >= requiredLevel;
  }
}
