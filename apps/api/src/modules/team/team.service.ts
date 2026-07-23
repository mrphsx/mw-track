import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { isElevatedRole } from '../../common/permissions/permission.constants';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { assertCanAssignRole, assertProjectsBelongToCompany } from './team-role.util';

const bcrypt = require('bcryptjs');

const TEAM_MEMBER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  projectAccess: { select: { project: { select: { id: true, name: true } } } },
  permissions: { select: { permission: true } },
} as const;

@Injectable()
export class TeamService {
  constructor(
    private prisma: PrismaService,
    private permissionsService: PermissionsService,
  ) {}

  async findAll(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId, deletedAt: null, role: { not: UserRole.SUPER_ADMIN } },
      select: TEAM_MEMBER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  // requesterRole — только Owner создаёт роль ADMIN (см. assertCanAssignRole); Admin может
  // создавать/менять только Buyer/Operator, ниже себя по факту, хотя формально тот же ранг
  // в RolesGuard — это разделение не выражается иерархией, поэтому явная проверка здесь.
  async create(companyId: string, requesterRole: UserRole, dto: CreateTeamMemberDto): Promise<User> {
    assertCanAssignRole(requesterRole, dto.role);

    if (dto.role !== 'ADMIN' && (!dto.projectIds || dto.projectIds.length === 0)) {
      throw new BadRequestException('Для роли Buyer/Operator нужно выбрать хотя бы один проект');
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email уже занят');

    if (dto.projectIds?.length) {
      await assertProjectsBelongToCompany(this.prisma, companyId, dto.projectIds);
    }

    const user = await this.prisma.user.create({
      data: {
        companyId,
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, 12),
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        projectAccess:
          dto.role !== 'ADMIN' && dto.projectIds?.length
            ? { create: dto.projectIds.map((projectId) => ({ projectId })) }
            : undefined,
      },
    });

    // Гранулярные права (запрос пользователя 2026-07-17) — ADMIN elevated, права не нужны.
    // Если форма явно прислала список (даже пустой — "снять всё") — используем его; иначе
    // засеваем дефолт по роли.
    if (!isElevatedRole(user.role)) {
      if (dto.permissions !== undefined) {
        await this.permissionsService.replacePermissions(user.id, dto.permissions);
      } else {
        await this.permissionsService.seedDefaultsIfEmpty(user.id, user.role);
      }
    }

    return user;
  }

  async update(companyId: string, requesterId: string, requesterRole: UserRole, userId: string, dto: UpdateTeamMemberDto): Promise<User> {
    if (userId === requesterId) {
      throw new BadRequestException('Нельзя менять роль/статус самому себе');
    }

    const member = await this.findMemberOrThrow(companyId, userId);

    if (dto.role) assertCanAssignRole(requesterRole, dto.role);

    // Guard rail: нельзя деактивировать/понизить последнего активного Owner компании —
    // иначе компания могла бы остаться без единого владельца.
    if (member.role === 'OWNER' && (dto.isActive === false || dto.role)) {
      const activeOwners = await this.prisma.user.count({ where: { companyId, role: 'OWNER', isActive: true, deletedAt: null } });
      if (activeOwners <= 1) throw new BadRequestException('Нельзя отключить/понизить единственного владельца компании');
    }

    if (dto.projectIds?.length) {
      await assertProjectsBelongToCompany(this.prisma, companyId, dto.projectIds);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.projectIds) {
        // Полная замена набора — проще и надёжнее диффа (см. комментарий в DTO).
        await tx.projectAccess.deleteMany({ where: { userId } });
        if (dto.role !== 'ADMIN' && (dto.role ?? member.role) !== 'ADMIN') {
          await tx.projectAccess.createMany({ data: dto.projectIds.map((projectId) => ({ userId, projectId })) });
        }
      }

      return tx.user.update({
        where: { id: userId },
        data: { role: dto.role, isActive: dto.isActive },
      });
    });

    // Гранулярные права — тот же принцип, что в create(): явный список (даже пустой) —
    // используем как есть; иначе, если это переход роли В BUYER/OPERATOR (понижение с ADMIN,
    // или роль не менялась) — засеиваем дефолт, только если у пользователя ещё 0 строк (см.
    // PermissionsService.seedDefaultsIfEmpty — не перетирает уже настроенное).
    if (!isElevatedRole(updated.role)) {
      if (dto.permissions !== undefined) {
        await this.permissionsService.replacePermissions(userId, dto.permissions);
      } else {
        await this.permissionsService.seedDefaultsIfEmpty(userId, updated.role);
      }
    }

    return updated;
  }

  // "Удаление" — мягкое отключение (User.deletedAt + isActive:false), не хард-делит —
  // соответствует общему инварианту проекта (см. CLAUDE.md). Переиспользует те же guard
  // rails, что и update() (нельзя тронуть себя/последнего Owner).
  async remove(companyId: string, requesterId: string, userId: string): Promise<void> {
    if (userId === requesterId) throw new BadRequestException('Нельзя отключить самого себя');

    const member = await this.findMemberOrThrow(companyId, userId);

    if (member.role === 'OWNER') {
      const activeOwners = await this.prisma.user.count({ where: { companyId, role: 'OWNER', isActive: true, deletedAt: null } });
      if (activeOwners <= 1) throw new BadRequestException('Нельзя отключить единственного владельца компании');
    }

    await this.prisma.user.update({ where: { id: userId }, data: { isActive: false, deletedAt: new Date() } });
  }

  private async findMemberOrThrow(companyId: string, userId: string): Promise<User> {
    const member = await this.prisma.user.findFirst({ where: { id: userId, companyId, deletedAt: null } });
    if (!member) throw new NotFoundException('Участник не найден');
    return member;
  }

  // Team Analytics (Фаза 3.6, запрос пользователя 2026-07-15) — атрибуция клиента к баеру
  // через скрытый параметр трекинг-ссылки (Client.buyerId, см. link-params.ts/GetLinkDialog),
  // не через привязку к лендингу (лендинг и пиксель могут использовать несколько баеров).
  async getBuyerAnalytics(companyId: string) {
    const [rows, users] = await Promise.all([
      this.prisma.$queryRaw<{ buyerId: string | null; clients: number; revenue: string }[]>`
        SELECT c."buyerId", COUNT(DISTINCT c.id)::int as clients, COALESCE(SUM(p.amount), 0) as revenue
        FROM "Client" c
        LEFT JOIN "Purchase" p ON p."clientId" = c.id
        WHERE c."companyId" = ${companyId} AND c."deletedAt" IS NULL
        GROUP BY c."buyerId"
      `,
      this.prisma.user.findMany({
        where: { companyId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, role: true },
      }),
    ]);

    const usersById = new Map(users.map((u) => [u.id, u]));
    const buyers: { userId: string; name: string; role: UserRole; clients: number; revenue: number }[] = [];
    let unattributed = { clients: 0, revenue: 0 };

    for (const row of rows) {
      const revenue = Number(row.revenue);
      if (row.buyerId === null) {
        unattributed = { clients: row.clients, revenue };
        continue;
      }
      const user = usersById.get(row.buyerId);
      buyers.push({
        userId: row.buyerId,
        // Пользователь мог быть отключён (User.deletedAt) — данные о нём как о баере всё
        // равно показываем (это история, не текущий доступ), но findMany выше отфильтровал
        // deletedAt:null, так что для уже удалённых участников имени не будет — честно
        // подписываем как "Удалённый пользователь", а не молча теряем строку.
        name: user ? `${user.firstName} ${user.lastName}`.trim() : 'Удалённый пользователь',
        role: user?.role ?? UserRole.BUYER,
        clients: row.clients,
        revenue,
      });
    }

    return { buyers, unattributed };
  }

  async getProjectComparison(companyId: string) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // totalRevenue — Postgres NUMERIC (SUM of Decimal(10,2)), node-postgres отдаёт его строкой
    // (не float, чтобы не терять точность неявно) — конвертируем явно, иначе фронтенд получит
    // строку там, где ждёт number (тот же класс бага, что уже чинили в ProjectsService.
    // getOverview с BigInt из COUNT(*) — здесь конвертация нужна на стороне API, не ::int).
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; totalClients: number; newClients: number; totalRevenue: string }[]>`
      SELECT pr.id, pr.name,
        COUNT(DISTINCT c.id)::int as "totalClients",
        COUNT(DISTINCT c.id) FILTER (WHERE c."createdAt" >= ${since})::int as "newClients",
        COALESCE(SUM(p.amount), 0) as "totalRevenue"
      FROM "Project" pr
      LEFT JOIN "Client" c ON c."projectId" = pr.id AND c."deletedAt" IS NULL
      LEFT JOIN "Purchase" p ON p."clientId" = c.id
      WHERE pr."companyId" = ${companyId} AND pr."deletedAt" IS NULL
      GROUP BY pr.id, pr.name
      ORDER BY pr.name ASC
    `;
    return rows.map((r) => ({ ...r, totalRevenue: Number(r.totalRevenue) }));
  }
}
