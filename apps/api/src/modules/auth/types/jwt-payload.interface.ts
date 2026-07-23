import { Permission, UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  companyId: string;
  role: UserRole;
  // Гранулярные права (запрос пользователя 2026-07-17) — [] для elevated ролей, реальный
  // список для BUYER/OPERATOR. Вычисляется один раз при выпуске токена (AuthService.
  // issueTokens), обновляется на каждый refresh (access token живёт 15 мин) — та же
  // задержка распространения, что уже была у смены role.
  permissions: Permission[];
  // только у refresh-токена: гарантирует уникальность токена даже если он выписан
  // в ту же секунду, что и предыдущий (iat одинаковый => без jti строка была бы идентичной,
  // и rotation/bcrypt.compare ловил бы "совпадение" со свежим токеном)
  jti?: string;
}
