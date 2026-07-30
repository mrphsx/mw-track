import { ForbiddenException, Injectable } from '@nestjs/common';
import { Permission, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_ROLE_PERMISSIONS, DOMAIN_PERMISSIONS, isElevatedRole } from './permission.constants';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  // Разрешения теперь per-project (запрос пользователя 2026-07-28) — используется для
  // "ручных" проверок частичного скрытия полей (STATS_VIEW_REVENUE и т.п., см.
  // permissions.util.ts), там, где полноценный 403 через ProjectsService.assertAccess не
  // подходит (ответ уже частично собран, нужно просто занулить/убрать поле). DB-backed, как и
  // assertAccess — тот же выбор в пользу мгновенного эффекта при изменении прав владельцем,
  // а не JWT-embedded карта с задержкой до обновления токена.
  async hasPermission(userId: string, projectId: string, role: UserRole, ...permissions: Permission[]): Promise<boolean> {
    if (isElevatedRole(role)) return true;
    const rows = await this.prisma.userPermission.findMany({
      where: { userId, projectId, permission: { in: permissions } },
      select: { permission: true },
    });
    const granted = new Set(rows.map((r) => r.permission));
    return permissions.every((p) => granted.has(p));
  }

  // DOMAINS_* — единственное исключение из per-project модели (решение пользователя: домены
  // технически не привязаны к одному проекту, Domain.projectId ни на что не влияет). Проверяем
  // "есть ли это право хотя бы на одном из проектов пользователя", без конкретного projectId —
  // хранится это право всё равно в той же таблице UserPermission с обычным projectId (см.
  // TeamService — при сохранении DOMAINS_* пишется одинаково на все проекты пользователя разом),
  // просто читается без фильтра по конкретному проекту.
  async hasAnyProjectPermission(userId: string, role: UserRole, ...permissions: Permission[]): Promise<boolean> {
    if (isElevatedRole(role)) return true;
    const rows = await this.prisma.userPermission.findMany({
      where: { userId, permission: { in: permissions } },
      select: { permission: true },
    });
    const granted = new Set(rows.map((r) => r.permission));
    return permissions.every((p) => granted.has(p));
  }

  // Throwing-обёртка над hasAnyProjectPermission — для роутов, где это единственная нужная
  // проверка (company-wide списки без конкретного projectId, например GET /landings).
  async assertAnyProjectPermission(userId: string, role: UserRole, ...permissions: Permission[]): Promise<void> {
    if (!(await this.hasAnyProjectPermission(userId, role, ...permissions))) {
      throw new ForbiddenException(`Недостаточно прав: ${permissions.join(', ')}`);
    }
  }

  // Полная замена набора прав НА ОДНОМ ПРОЕКТЕ (не патч, не все проекты сразу) — тот же принцип
  // "replace целиком", что и раньше, просто теперь область — конкретный (userId, projectId).
  async replacePermissionsForProject(userId: string, projectId: string, permissions: Permission[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userPermission.deleteMany({ where: { userId, projectId } }),
      this.prisma.userPermission.createMany({
        data: permissions.map((permission) => ({ userId, projectId, permission })),
        skipDuplicates: true,
      }),
    ]);
  }

  // Вызывается при КАЖДОМ новом ProjectAccess-гранте BUYER/OPERATOR (не только при смене роли,
  // как раньше — теперь ещё и когда существующему сотруднику добавляют новый проект) — если на
  // этом конкретном (userId, projectId) ещё 0 строк, сеет дефолт по роли. НЕ перезаписывает уже
  // настроенные права этого проекта (только если пусто).
  async seedDefaultsIfEmpty(userId: string, projectId: string, role: UserRole): Promise<void> {
    if (isElevatedRole(role)) return;
    const existing = await this.prisma.userPermission.count({ where: { userId, projectId } });
    if (existing > 0) return;
    const defaults = DEFAULT_ROLE_PERMISSIONS[role] ?? [];
    if (defaults.length === 0) return;
    await this.prisma.userPermission.createMany({
      data: defaults.map((permission) => ({ userId, projectId, permission })),
      skipDuplicates: true,
    });
  }

  // Общая точка применения per-project прав при создании/редактировании участника команды
  // ИЛИ принятии инвайт-ссылки (запрос пользователя 2026-07-28) — вынесено сюда, а не
  // продублировано в TeamService/TeamInvitesService по отдельности. На каждый projectId:
  // явный projectPermissions-элемент для него — replace целиком; иначе, если у пользователя
  // на этом проекте ещё 0 строк — засеять дефолт по роли (не перезаписывает уже настроенное).
  // DOMAINS_* — общее право роли (решение пользователя), применяется одинаково на КАЖДЫЙ из
  // projectIds — hasAnyProjectPermission не смотрит, на каком именно проекте лежит строка.
  async applyProjectPermissions(
    userId: string,
    role: UserRole,
    projectIds: string[],
    projectPermissions: { projectId: string; permissions: Permission[] }[] | undefined,
    domainsPermissions: Permission[] | undefined,
  ): Promise<void> {
    if (isElevatedRole(role)) return;

    const explicit = new Map((projectPermissions ?? []).map((p) => [p.projectId, p.permissions]));
    for (const projectId of projectIds) {
      const permissions = explicit.get(projectId);
      if (permissions !== undefined) {
        await this.replacePermissionsForProject(userId, projectId, permissions);
      } else {
        await this.seedDefaultsIfEmpty(userId, projectId, role);
      }
    }

    // Полная замена на КАЖДОМ проекте разом (не add-only createMany, как было раньше) —
    // без этого снятая в UI галочка DOMAINS_DELETE никогда бы не удалялась из БД, только
    // добавлялись бы новые права (найдено при проектировании фронтенда 2026-07-28).
    // undefined (а не []) — сигнал "поле не передали вообще", тогда домены не трогаем
    // (обратная совместимость со старыми инвайтами до этого редизайна, см. TeamInvitesService).
    if (domainsPermissions !== undefined) {
      await Promise.all(
        projectIds.map((projectId) =>
          this.prisma.$transaction([
            this.prisma.userPermission.deleteMany({ where: { userId, projectId, permission: { in: DOMAIN_PERMISSIONS } } }),
            this.prisma.userPermission.createMany({
              data: domainsPermissions.map((permission) => ({ userId, projectId, permission })),
              skipDuplicates: true,
            }),
          ]),
        ),
      );
    }
  }

  // Для user-объекта в ответах auth (login/register/refresh/me) — только UI-подсказка
  // (показать/скрыть кнопки на фронтенде), реальная защита всегда идёт через
  // assertAccess/hasPermission выше, JWT больше не несёт прав вообще (запрос пользователя
  // 2026-07-28, per-project редизайн). Elevated роли — {} (как раньше был []).
  async resolvePermissionsByProject(userId: string, role: UserRole): Promise<Record<string, Permission[]>> {
    if (isElevatedRole(role)) return {};
    const rows = await this.prisma.userPermission.findMany({ where: { userId }, select: { projectId: true, permission: true } });
    const byProject: Record<string, Permission[]> = {};
    for (const row of rows) {
      (byProject[row.projectId] ??= []).push(row.permission);
    }
    return byProject;
  }
}
