import { Permission } from '@prisma/client';
import { AuthUser } from '../decorators/current-user.decorator';
import { isElevatedRole } from './permission.constants';

// Для частичного сокрытия полей внутри одного ответа (не 403 целиком) — например, выручка/
// топ-лидерборд команды в статистике проекта. Гвард (PermissionsGuard) даёт только
// "всё или ничего" на уровне роута, для этого нужна ручная проверка в контроллере/сервисе,
// который уже видит и умеет частично собрать ответ.
export function hasPermission(user: AuthUser, ...permissions: Permission[]): boolean {
  if (isElevatedRole(user.role)) return true;
  return permissions.every((p) => user.permissions.includes(p));
}
