import { SetMetadata } from '@nestjs/common';
import { Permission } from '@prisma/client';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

// @RequirePermission(Permission.LANDINGS_CREATE) — зеркалит @Roles(), но проверяется
// PermissionsGuard, не RolesGuard. Несколько прав = ALL требуются (AND), не OR.
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(REQUIRE_PERMISSION_KEY, permissions);
