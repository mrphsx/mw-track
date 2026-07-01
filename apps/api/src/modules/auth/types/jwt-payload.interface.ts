import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  companyId: string;
  role: UserRole;
  // только у refresh-токена: гарантирует уникальность токена даже если он выписан
  // в ту же секунду, что и предыдущий (iat одинаковый => без jti строка была бы идентичной,
  // и rotation/bcrypt.compare ловил бы "совпадение" со свежим токеном)
  jti?: string;
}
