import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Permission, TeamInvite, UserRole } from '@prisma/client';
import { addDays } from 'date-fns';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { isElevatedRole } from '../../common/permissions/permission.constants';
import { AuthService } from '../auth/auth.service';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { assertCanAssignRole, assertProjectsBelongToCompany } from './team-role.util';

const bcrypt = require('bcryptjs');

const INVITE_TTL_DAYS = 7;

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

    return this.prisma.teamInvite.create({
      data: {
        companyId,
        token: nanoid(32),
        role: dto.role,
        projectIds: dto.role === 'ADMIN' ? undefined : dto.projectIds,
        permissions: dto.role === 'ADMIN' ? undefined : dto.permissions,
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

    // Гранулярные права — если приглашение несло явный список (даже пустой), используем его;
    // иначе (включая старые TeamInvite, созданные до этого поля) засеиваем дефолт по роли.
    if (!isElevatedRole(user.role)) {
      const permissions = invite.permissions as Permission[] | null;
      if (permissions !== null && permissions !== undefined) {
        await this.permissionsService.replacePermissions(user.id, permissions);
      } else {
        await this.permissionsService.seedDefaultsIfEmpty(user.id, user.role);
      }
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
