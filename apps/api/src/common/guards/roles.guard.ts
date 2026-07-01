import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

const roleHierarchy: Record<UserRole, number> = {
  SUPER_ADMIN: 4,
  OWNER: 3,
  ADMIN: 2,
  ADVERTISER: 1,
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
