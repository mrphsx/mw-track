import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Permission, Prisma, TeamInvite, UserRole } from '@prisma/client';
import { addDays } from 'date-fns';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { isElevatedRole } from '../../common/permissions/permission.constants';
import { AuthService } from '../auth/auth.service';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { ProjectPermissionsDto } from './dto/create-team-member.dto';
import { assertCanAssignRole, assertProjectsBelongToCompany } from './team-role.util';

const bcrypt = require('bcryptjs');

const INVITE_TTL_DAYS = 7;

// Per-project права (запрос пользователя 2026-07-28) в один JSON-блоб вместо плоского массива
// — TeamInvite.permissions остаётся Json? без миграции схемы, просто меняем трактовку формы.
interface InvitePermissionsPayload {
  projectPermissions?: ProjectPermissionsDto[];
  domainsPermissions?: Permission[];
}

@Injectable()
export class TeamInvitesService {
  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
    private permissionsService: PermissionsService,
  ) {}

  // TeamInvite исключён из tenant-scoping middleware (нет deletedAt, см. schema.prisma) —
  // companyId фильтруется вручную здесь же, как у Channel/Domain.
  async findAll(companyId: string): Promise<TeamInvite[]> {
    return this.prisma.teamInvite.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  }

  async create(companyId: string, requesterId: string, requesterRole: UserRole, dto: CreateInviteDto): Promise<TeamInvite> {
    assertCanAssignRole(requesterRole, dto.role);

    if (dto.role !== 'ADMIN' && (!dto.projectIds || dto.projectIds.length === 0)) {
      throw new BadRequestException('Для роли Buyer/Operator нужно выбрать хотя бы один проект');
    }

    if (dto.projectIds?.length) {
      await assertProjectsBelongToCompany(this.prisma, companyId, dto.projectIds);
    }

    const permissionsPayload: InvitePermissionsPayload = {
      projectPermissions: dto.projectPermissions,
      domainsPermissions: dto.domainsPermissions,
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
  async revoke(companyId: string, id: string): Promise<void> {
    const invite = await this.prisma.teamInvite.findFirst({ where: { id, companyId } });
    if (!invite) throw new NotFoundException('Приглашение не найдено');
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

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          companyId: invite.companyId,
          email: dto.email,
          passwordHash: await bcrypt.hash(dto.password, 12),
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: invite.role,
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
      const raw = invite.permissions as unknown;
      const legacyFlatList = Array.isArray(raw) ? (raw as Permission[]) : null;
      const payload = !legacyFlatList && raw && typeof raw === 'object' ? (raw as InvitePermissionsPayload) : null;

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
