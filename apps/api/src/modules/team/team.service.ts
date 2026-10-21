import { projectPeriodWindowsSql } from '../../common/timezone.util';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { formatUserName } from '../../common/user-name.util';
import { withUniqueShortCode } from '../../common/short-code.util';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import {
  assertCanAccessTeamManagement,
  assertCanAssignRole,
  assertOperatorAdminScope,
  assertProjectsBelongToCompany,
} from './team-role.util';

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
  landingsVisibilityScope: true,
  landingsEditScope: true,
  landingsDeleteScope: true,
  clientsVisibilityScope: true,
  projectAccess: { select: { project: { select: { id: true, name: true } } } },
  permissions: { select: { projectId: true, permission: true } },
} as const;

@Injectable()
export class TeamService {
  constructor(
    private prisma: PrismaService,
    private permissionsService: PermissionsService,
  ) {}

  // requesterId/requesterRole — для OPERATOR_ADMIN список сужается до Operator-ов, чьи проекты
  // пересекаются с его собственными (запрос пользователя 2026-07-30: "видит только своих").
  async findAll(companyId: string, requesterId: string, requesterRole: UserRole) {
    assertCanAccessTeamManagement(requesterRole);

    if (requesterRole === UserRole.OPERATOR_ADMIN) {
      const own = await this.prisma.projectAccess.findMany({ where: { userId: requesterId }, select: { projectId: true } });
      const ownIds = own.map((a) => a.projectId);
      return this.prisma.user.findMany({
        where: { companyId, deletedAt: null, role: UserRole.OPERATOR, projectAccess: { some: { projectId: { in: ownIds } } } },
        select: TEAM_MEMBER_SELECT,
        orderBy: { createdAt: 'asc' },
      });
    }

    return this.prisma.user.findMany({
      where: { companyId, deletedAt: null, role: { not: UserRole.SUPER_ADMIN } },
      select: TEAM_MEMBER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  // requesterRole — только Owner создаёт роль ADMIN (см. assertCanAssignRole); Admin может
  // создавать/менять только Buyer/Operator, ниже себя по факту, хотя формально тот же ранг
  // в RolesGuard — это разделение не выражается иерархией, поэтому явная проверка здесь.
  // requesterId нужен только для OPERATOR_ADMIN (assertOperatorAdminScope сверяет dto.projectIds
  // с его собственным ProjectAccess) — для остальных ролей игнорируется.
  async create(companyId: string, requesterId: string, requesterRole: UserRole, dto: CreateTeamMemberDto): Promise<User> {
    assertCanAccessTeamManagement(requesterRole);
    assertCanAssignRole(requesterRole, dto.role);

    // Operator — единственное исключение из "проекты обязательны при создании" (запрос
    // пользователя 2026-07-31: "изначально у него нет доступных проектов" — доступ выдаётся
    // отдельно, позже, через новые /projects/:id/operators или карточку оператора). Buyer и
    // Оператор-админ по-прежнему требуют хотя бы один проект сразу.
    if (dto.role !== 'ADMIN' && dto.role !== 'OPERATOR' && (!dto.projectIds || dto.projectIds.length === 0)) {
      throw new BadRequestException('Для роли Buyer/Оператор-админ нужно выбрать хотя бы один проект');
    }

    await assertOperatorAdminScope(this.prisma, requesterId, requesterRole, dto.role as UserRole, dto.projectIds);

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email уже занят');

    if (dto.projectIds?.length) {
      await assertProjectsBelongToCompany(this.prisma, companyId, dto.projectIds);
    }

    // buyerShortCode (запрос пользователя 2026-08-20) — см. комментарий у AuthService.register.
    const user = await withUniqueShortCode(async (buyerShortCode) =>
      this.prisma.user.create({
        data: {
          companyId,
          email: dto.email,
          passwordHash: await bcrypt.hash(dto.password, 12),
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: dto.role,
          landingsVisibilityScope: dto.landingsVisibilityScope,
          landingsEditScope: dto.landingsEditScope,
          landingsDeleteScope: dto.landingsDeleteScope,
          clientsVisibilityScope: dto.clientsVisibilityScope,
          buyerShortCode,
          projectAccess:
            dto.role !== 'ADMIN' && dto.projectIds?.length
              ? { create: dto.projectIds.map((projectId) => ({ projectId })) }
              : undefined,
        },
      }),
    );

    if (dto.role !== 'ADMIN' && dto.projectIds?.length) {
      await this.permissionsService.applyProjectPermissions(user.id, user.role, dto.projectIds, dto.projectPermissions, dto.domainsPermissions);
    }

    return user;
  }

  async update(companyId: string, requesterId: string, requesterRole: UserRole, userId: string, dto: UpdateTeamMemberDto): Promise<User> {
    assertCanAccessTeamManagement(requesterRole);

    if (userId === requesterId) {
      throw new BadRequestException('Нельзя менять роль/статус самому себе');
    }

    const member = await this.findMemberOrThrow(companyId, userId);

    if (dto.role) assertCanAssignRole(requesterRole, dto.role);

    // Проверяем И существующий набор проектов цели, И новый dto.projectIds — update делает
    // полную замену набора (см. ниже), частичное обновление могло бы иначе тихо снять доступ
    // оператора к проекту вне зоны видимости оператор-админа, о котором тот даже не узнал бы.
    const existingAccessForScope = await this.prisma.projectAccess.findMany({ where: { userId }, select: { projectId: true } });
    await assertOperatorAdminScope(
      this.prisma,
      requesterId,
      requesterRole,
      (dto.role ?? member.role) as UserRole,
      existingAccessForScope.map((a) => a.projectId),
      dto.projectIds,
    );

    // Guard rail: нельзя деактивировать/понизить последнего активного Owner компании —
    // иначе компания могла бы остаться без единого владельца.
    if (member.role === 'OWNER' && (dto.isActive === false || dto.role)) {
      const activeOwners = await this.prisma.user.count({ where: { companyId, role: 'OWNER', isActive: true, deletedAt: null } });
      if (activeOwners <= 1) throw new BadRequestException('Нельзя отключить/понизить единственного владельца компании');
    }

    if (dto.projectIds?.length) {
      await assertProjectsBelongToCompany(this.prisma, companyId, dto.projectIds);
    }

    // Редактирование данных сотрудника (запрос пользователя 2026-08-03) — та же проверка
    // уникальности email, что и при создании (см. create() выше).
    if (dto.email && dto.email !== member.email) {
      const emailTaken = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (emailTaken) throw new ConflictException('Email уже занят');
    }
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 12) : undefined;

    const nextRole = (dto.role ?? member.role) as UserRole;
    const becomesRestricted = nextRole !== 'ADMIN';

    // Пустой projectIds легитимен ТОЛЬКО для Operator (запрос пользователя 2026-07-31: "должна
    // быть возможность убрать все проекты у оператора, чтобы он остался без проектов") — раньше
    // это блокировал `@ArrayMinSize(1)` на самом DTO безусловно для всех ролей; теперь декоратор
    // снят, а минимум в один проект для Buyer/Оператор-админ проверяется явно здесь же.
    if (dto.projectIds && dto.projectIds.length === 0 && nextRole !== 'OPERATOR' && nextRole !== 'ADMIN') {
      throw new BadRequestException('Для роли Buyer/Оператор-админ нужно выбрать хотя бы один проект');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.projectIds) {
        // Полная замена набора — проще и надёжнее диффа (см. комментарий в DTO). Очистка
        // осиротевших UserPermission-строк (запрос пользователя 2026-07-28, найдено при
        // проектировании per-project прав): без этого повторное добавление того же проекта
        // позже тихо воскресило бы старый набор прав в обход seedDefaultsIfEmpty (тот сеет
        // дефолт только когда строк 0 — а они не были бы 0, если бы мы их не почистили здесь).
        const existingAccess = await tx.projectAccess.findMany({ where: { userId }, select: { projectId: true } });
        const removedProjectIds = existingAccess.map((a) => a.projectId).filter((id) => !dto.projectIds!.includes(id));

        await tx.projectAccess.deleteMany({ where: { userId } });
        if (removedProjectIds.length > 0) {
          await tx.userPermission.deleteMany({ where: { userId, projectId: { in: removedProjectIds } } });
        }
        if (becomesRestricted && dto.projectIds.length > 0) {
          await tx.projectAccess.createMany({ data: dto.projectIds.map((projectId) => ({ userId, projectId })) });
        } else if (!becomesRestricted) {
          // Переход в ADMIN — elevated, ProjectAccess/UserPermission ему не нужны вообще.
          await tx.userPermission.deleteMany({ where: { userId } });
        }
      }

      return tx.user.update({
        where: { id: userId },
        data: {
          role: dto.role,
          isActive: dto.isActive,
          landingsVisibilityScope: dto.landingsVisibilityScope,
          landingsEditScope: dto.landingsEditScope,
          landingsDeleteScope: dto.landingsDeleteScope,
          clientsVisibilityScope: dto.clientsVisibilityScope,
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          passwordHash,
        },
      });
    });

    if (becomesRestricted) {
      const projectIds = dto.projectIds ?? (await this.prisma.projectAccess.findMany({ where: { userId }, select: { projectId: true } })).map((a) => a.projectId);
      await this.permissionsService.applyProjectPermissions(userId, updated.role, projectIds, dto.projectPermissions, dto.domainsPermissions);
    }

    return updated;
  }

  // "Удаление" — мягкое отключение (User.deletedAt + isActive:false), не хард-делит —
  // соответствует общему инварианту проекта (см. CLAUDE.md). Переиспользует те же guard
  // rails, что и update() (нельзя тронуть себя/последнего Owner).
  async remove(companyId: string, requesterId: string, requesterRole: UserRole, userId: string): Promise<void> {
    assertCanAccessTeamManagement(requesterRole);
    if (userId === requesterId) throw new BadRequestException('Нельзя отключить самого себя');

    const member = await this.findMemberOrThrow(companyId, userId);

    if (requesterRole === UserRole.OPERATOR_ADMIN) {
      const existingAccess = await this.prisma.projectAccess.findMany({ where: { userId }, select: { projectId: true } });
      await assertOperatorAdminScope(this.prisma, requesterId, requesterRole, member.role, existingAccess.map((a) => a.projectId));
    }

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
  // Аналитика команды за всё время. С 2026-10-21 считается по тем же правилам, что главная и
  // страница проекта: только активные (не архивные) проекты, клиенты — «наши» (прошли воронку,
  // subscribedAt не пуст), выручка — покупки только таких клиентов. Раньше сюда попадали
  // внешние контакты и архивные проекты, и цифры не сходились с главной за «Всё время».
  // Удалённый баер показывается со своим именем и флагом isDeleted (фронт красит красным),
  // а не «Удалённый пользователь» — история баера из системы не пропадает.
  async getBuyerAnalytics(companyId: string) {
    const [rows, users] = await Promise.all([
      this.prisma.$queryRaw<{ buyerId: string | null; clients: number; revenue: string }[]>`
        SELECT c."buyerId",
          COUNT(DISTINCT c.id) FILTER (WHERE c."subscribedAt" IS NOT NULL)::int as clients,
          COALESCE(SUM(p.amount), 0) as revenue
        FROM "Client" c
        JOIN "Project" pr ON pr.id = c."projectId" AND pr."deletedAt" IS NULL
        LEFT JOIN "Purchase" p ON p."clientId" = c.id AND c."subscribedAt" IS NOT NULL
        WHERE c."companyId" = ${companyId} AND c."deletedAt" IS NULL
        GROUP BY c."buyerId"
      `,
      this.prisma.user.findMany({
        where: { companyId },
        select: { id: true, firstName: true, lastName: true, role: true, deletedAt: true },
      }),
    ]);

    const usersById = new Map(users.map((u) => [u.id, u]));
    const buyers: { userId: string; name: string; role: UserRole; clients: number; revenue: number; isDeleted: boolean }[] = [];
    let unattributed = { clients: 0, revenue: 0 };

    for (const row of rows) {
      const revenue = Number(row.revenue);
      if (row.buyerId === null) {
        unattributed = { clients: row.clients, revenue };
        continue;
      }
      if (row.clients === 0 && revenue === 0) continue;
      const user = usersById.get(row.buyerId);
      buyers.push({
        userId: row.buyerId,
        name: user ? formatUserName(user) : 'Некорректный ID баера',
        role: user?.role ?? UserRole.BUYER,
        clients: row.clients,
        revenue,
        isDeleted: !!user?.deletedAt,
      });
    }

    buyers.sort((a, b) => b.revenue - a.revenue || b.clients - a.clients);
    return { buyers, unattributed };
  }

  // «Клиентов всего» / «Новых за 30 дней» / «Выручка» по проектам — те же правила, что выше;
  // 30 дней — календарные сутки в часовом поясе каждого проекта (как пресет «30 дней» на
  // странице проекта), чтобы цифры совпадали.
  async getProjectComparison(companyId: string) {
    const projects = await this.prisma.project.findMany({ where: { companyId, deletedAt: null }, select: { id: true } });
    if (projects.length === 0) return [];
    const windows = projectPeriodWindowsSql(projects.map((p) => p.id), { period: '30d' });
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; totalClients: number; newClients: number; totalRevenue: string }[]>`
      WITH w AS (${windows})
      SELECT pr.id, pr.name,
        COUNT(DISTINCT c.id) FILTER (WHERE c."subscribedAt" IS NOT NULL)::int as "totalClients",
        COUNT(DISTINCT c.id) FILTER (WHERE c."subscribedAt" >= w.since AND c."subscribedAt" < w.until)::int as "newClients",
        COALESCE(SUM(p.amount), 0) as "totalRevenue"
      FROM "Project" pr
      JOIN w ON w.pid = pr.id
      LEFT JOIN "Client" c ON c."projectId" = pr.id AND c."deletedAt" IS NULL
      LEFT JOIN "Purchase" p ON p."clientId" = c.id AND c."subscribedAt" IS NOT NULL
      GROUP BY pr.id, pr.name
      ORDER BY pr.name ASC
    `;
    return rows.map((r) => ({ ...r, totalRevenue: Number(r.totalRevenue) }));
  }
}
