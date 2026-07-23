import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from '@prisma/client';
import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';
import { isElevatedRole } from './permission.constants';
import { AuthUser } from '../decorators/current-user.decorator';

// Права уже лежат в JWT (см. AuthService.issueTokens) — гвард ничего не спрашивает у БД,
// та же логика "ноль накладных расходов на запрос", что и RolesGuard. Elevated роли
// (OWNER/ADMIN/SUPER_ADMIN) пропускаются безусловно — permissions у них всегда [] и это
// нормально, не баг.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) return false;
    if (isElevatedRole(user.role)) return true;

    const granted = user.permissions ?? [];
    const missing = required.filter((p) => !granted.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Недостаточно прав: ${missing.join(', ')}`);
    }
    return true;
  }
}
