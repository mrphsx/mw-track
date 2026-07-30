import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  companyId: string;
  role: UserRole;
  // Права больше НЕ в JWT (запрос пользователя 2026-07-28, per-project редизайн) — они
  // per-project теперь, а не плоские, и токен не в курсе, какого проекта касается запрос.
  // Реальная проверка всегда идёт DB-backed через ProjectsService.assertAccess/
  // PermissionsService.hasPermission, см. permissions.service.ts.
  // только у refresh-токена: гарантирует уникальность токена даже если он выписан
  // в ту же секунду, что и предыдущий (iat одинаковый => без jti строка была бы идентичной,
  // и rotation/bcrypt.compare ловил бы "совпадение" со свежим токеном)
  jti?: string;
}
