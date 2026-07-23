import { Injectable } from '@nestjs/common';
import { Permission, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_ROLE_PERMISSIONS, isElevatedRole } from './permission.constants';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  // Для JWT/фронтенда — elevated роли получают [] (гвард/hasPermission их всё равно
  // пропускают безусловно по role, список прав им не нужен), restricted — реальные строки.
  async resolvePermissionsForToken(userId: string, role: UserRole): Promise<Permission[]> {
    if (isElevatedRole(role)) return [];
    const rows = await this.prisma.userPermission.findMany({ where: { userId }, select: { permission: true } });
    return rows.map((r) => r.permission);
  }

  // Полная замена набора прав (не патч) — тот же паттерн, что ProjectAccess уже использует
  // в TeamService.update (замена целиком проще и надёжнее диффа).
  async replacePermissions(userId: string, permissions: Permission[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userPermission.deleteMany({ where: { userId } }),
      this.prisma.userPermission.createMany({
        data: permissions.map((permission) => ({ userId, permission })),
        skipDuplicates: true,
      }),
    ]);
  }

  // Вызывается при любом переходе роли В BUYER/OPERATOR (создание, понижение с ADMIN, смена
  // BUYER<->OPERATOR без явного списка прав в запросе) — если у пользователя уже 0 строк,
  // сеет дефолт по роли. НЕ перезаписывает уже настроенные права (только если пусто) —
  // иначе Owner потерял бы кастомизацию при каждом сохранении формы без явного permissions.
  async seedDefaultsIfEmpty(userId: string, role: UserRole): Promise<void> {
    if (isElevatedRole(role)) return;
    const existing = await this.prisma.userPermission.count({ where: { userId } });
    if (existing > 0) return;
    const defaults = DEFAULT_ROLE_PERMISSIONS[role] ?? [];
    if (defaults.length === 0) return;
    await this.prisma.userPermission.createMany({
      data: defaults.map((permission) => ({ userId, permission })),
      skipDuplicates: true,
    });
  }
}
