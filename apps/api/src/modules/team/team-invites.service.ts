import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientsVisibilityScope, LandingsVisibilityScope, Permission, Prisma, TeamInvite, UserRole } from '@prisma/client';
import { addDays } from 'date-fns';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { isElevatedRole } from '../../common/permissions/permission.constants';
import { generateUniqueBuyerShortCode } from '../../common/short-code.util';
import { AuthService } from '../auth/auth.service';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { ProjectPermissionsDto } from './dto/create-team-member.dto';
import {
  assertCanAccessTeamManagement,
  assertCanAssignRole,
  assertOperatorAdminScope,
  assertProjectsBelongToCompany,
} from './team-role.util';

const bcrypt = require('bcryptjs');

const INVITE_TTL_DAYS = 7;

// Per-project права (запрос пользователя 2026-07-28) в один JSON-блоб вместо плоского массива
// — TeamInvite.permissions остаётся Json? без миграции схемы, просто меняем трактовку формы.
interface InvitePermissionsPayload {
  projectPermissions?: ProjectPermissionsDto[];
  domainsPermissions?: Permission[];
  landingsVisibilityScope?: LandingsVisibilityScope;
  clientsVisibilityScope?: ClientsVisibilityScope;
}

@Injectable()
export class TeamInvitesService {
  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
    private permissionsService: PermissionsService,
  ) {}

  // TeamInvite исключён из tenant-scoping middleware (нет deletedAt, см. schema.prisma) —
  // companyId фильтруется вручную здесь же, как у Channel/Domain. Для OPERATOR_ADMIN список
  // сужается до приглашений с ролью Operator, чьи projectIds пересекаются с его собственными
  // (тот же принцип, что TeamService.findAll — запрос пользователя 2026-07-30).
  async findAll(companyId: string, requesterId: string, requesterRole: UserRole): Promise<TeamInvite[]> {
    assertCanAccessTeamManagement(requesterRole);

    if (requesterRole === UserRole.OPERATOR_ADMIN) {
      const own = await this.prisma.projectAccess.findMany({ where: { userId: requesterId }, select: { projectId: true } });
      const ownIds = new Set(own.map((a) => a.projectId));
      const invites = await this.prisma.teamInvite.findMany({ where: { companyId, role: UserRole.OPERATOR }, orderBy: { createdAt: 'desc' } });
      return invites.filter((inv) => ((inv.projectIds as string[] | null) ?? []).some((id) => ownIds.has(id)));
    }

    return this.prisma.teamInvite.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  }

  async create(companyId: string, requesterId: string, requesterRole: UserRole, dto: CreateInviteDto): Promise<TeamInvite> {
    assertCanAccessTeamManagement(requesterRole);
    assertCanAssignRole(requesterRole, dto.role);

    // Operator — то же исключение, что и в TeamService.create (2026-07-31): приглашение с
    // ролью Operator не требует projectIds, accept() ниже уже переживает пустой список.
    if (dto.role !== 'ADMIN' && dto.role !== 'OPERATOR' && (!dto.projectIds || dto.projectIds.length === 0)) {
      throw new BadRequestException('Для роли Buyer/Оператор-админ нужно выбрать хотя бы один проект');
    }

    await assertOperatorAdminScope(this.prisma, requesterId, requesterRole, dto.role as UserRole, dto.projectIds);

    if (dto.projectIds?.length) {
      await assertProjectsBelongToCompany(this.prisma, companyId, dto.projectIds);
    }

    const permissionsPayload: InvitePermissionsPayload = {
      projectPermissions: dto.projectPermissions,
      domainsPermissions: dto.domainsPermissions,
      landingsVisibilityScope: dto.landingsVisibilityScope,
      clientsVisibilityScope: dto.clientsVisibilityScope,
    };

    return this.prisma.teamInvite.create({
      data: {
        companyId,
        token: nanoid(32),
        role: dto.role,
        projectIds: dto.role === 'ADMIN' ? undefined : dto.projectIds,
        permissions: dto.role === 'ADMIN' ? undefined : (permissionsPayload as unknown as Prisma.InputJsonValue),
        createdById: requesterId,
        expiresAt: addDays(new Date(), INVITE_TTL_DAYS),
      },
    });
  }

  // Хард-делит — TeamInvite не тенантные данные, а транзитный токен (см. schema.prisma и
  // CLAUDE.md, тот же принцип, что у RefreshToken).
  async revoke(companyId: string, requesterId: string, requesterRole: UserRole, id: string): Promise<void> {
    assertCanAccessTeamManagement(requesterRole);
    const invite = await this.prisma.teamInvite.findFirst({ where: { id, companyId } });
    if (!invite) throw new NotFoundException('Приглашение не найдено');
    if (requesterRole === UserRole.OPERATOR_ADMIN) {
      await assertOperatorAdminScope(this.prisma, requesterId, requesterRole, invite.role, (invite.projectIds as string[] | null) ?? undefined);
    }
    await this.prisma.teamInvite.delete({ where: { id } });
  }

  // Публичный — токен сам по себе авторизация, компания/роль показываются, чтобы человек
  // понимал куда его приглашают, прежде чем вводить пароль.
  async preview(token: string): Promise<{ companyName: string; role: UserRole }> {
    const invite = await this.findValidInvite(token);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: invite.companyId } });
    return { companyName: company.name, role: invite.role };
  }

  async accept(token: string, dto: AcceptInviteDto) {
    const invite = await this.findValidInvite(token);

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email уже занят');

    const projectIds = (invite.projectIds as string[] | null) ?? [];

    // Распарсено ДО транзакции — landingsVisibilityScope нужен уже в user.create (скалярное
    // поле User), в отличие от projectPermissions/domainsPermissions, которые применяются
    // отдельным вызовом applyProjectPermissions уже после создания пользователя.
    const raw = invite.permissions as unknown;
    const legacyFlatList = Array.isArray(raw) ? (raw as Permission[]) : null;
    const payload = !legacyFlatList && raw && typeof raw === 'object' ? (raw as InvitePermissionsPayload) : null;

    // buyerShortCode (запрос пользователя 2026-08-20) — сгенерирован ДО транзакции (см.
    // generateUniqueBuyerShortCode: catch-и-повтори внутри $transaction здесь небезопасен,
    // Postgres абортит всю транзакцию при первой же ошибке).
    const buyerShortCode = await generateUniqueBuyerShortCode(this.prisma);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          companyId: invite.companyId,
          email: dto.email,
          passwordHash: await bcrypt.hash(dto.password, 12),
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: invite.role,
          landingsVisibilityScope: payload?.landingsVisibilityScope,
          clientsVisibilityScope: payload?.clientsVisibilityScope,
          buyerShortCode,
          projectAccess: invite.role !== 'ADMIN' && projectIds.length ? { create: projectIds.map((projectId) => ({ projectId })) } : undefined,
        },
        include: { company: true },
      });

      // updateMany + count-проверка вместо update — закрывает гонку одновременного
      // принятия одной и той же ссылки двумя людьми (см. комментарий в team-invites.service).
      const claimed = await tx.teamInvite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date(), usedByUserId: created.id },
      });
      if (claimed.count === 0) throw new BadRequestException('Приглашение уже использовано');

      return created;
    });

    // Гранулярные права — новая per-project форма (запрос пользователя 2026-07-28): если
    // приглашение несло явный projectPermissions/domainsPermissions, используем их через тот
    // же общий applyProjectPermissions, что и TeamService (иначе на проектах без явного
    // элемента засеется дефолт по роли — тот же принцип, что раньше). Обратная совместимость
    // со СТАРОЙ формой (плоский Permission[], созданный до этого редизайна) — если сохранённое
    // значение оказалось голым массивом, а не объектом, трактуем как явный список, применяемый
    // одинаково на каждый выданный проект (эквивалент старого поведения).
    if (!isElevatedRole(user.role) && projectIds.length > 0) {
      await this.permissionsService.applyProjectPermissions(
        user.id,
        user.role,
        projectIds,
        legacyFlatList ? projectIds.map((projectId) => ({ projectId, permissions: legacyFlatList })) : payload?.projectPermissions,
        payload?.domainsPermissions,
      );
    }

    return this.authService.issueTokensForUser(user);
  }

  private async findValidInvite(token: string): Promise<TeamInvite> {
    const invite = await this.prisma.teamInvite.findUnique({ where: { token } });
    if (!invite || invite.usedAt) throw new NotFoundException('Приглашение не найдено или уже использовано');
    if (invite.expiresAt < new Date()) throw new BadRequestException('Срок действия приглашения истёк');
    return invite;
  }
}
