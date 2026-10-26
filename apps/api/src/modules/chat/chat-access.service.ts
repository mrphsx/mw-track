import { BadRequestException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { formatUserName } from '../../common/user-name.util';
import { ProjectsService } from '../projects/projects.service';

export interface ChatResourceInfo {
  key: string; // 'BOT' | 'BOT:<id>' | 'PERSONAL'
  kind: 'BOT' | 'EXTRA_BOT' | 'PERSONAL';
  title: string;
  connected: boolean;
}

// Операторы на чатах отдельных ресурсов проекта (запрос пользователя 2026-10-24: «добавить
// оператора под каждый ресурс — бот, личка» прямо в чате или в настройках проекта). Права — те же,
// что на управление операторами проекта (ProjectsService.assertCanManageProjectOperators).
// Назначение оператора, которого ещё нет в проекте, сначала добавляет его в проект обычным путём
// (ProjectAccess + стандартные права оператора).
@Injectable()
export class ChatAccessService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
  ) {}

  private async resources(projectId: string): Promise<ChatResourceInfo[]> {
    const [channel, extraBots] = await Promise.all([
      this.prisma.channel.findUnique({
        where: { projectId },
        select: { type: true, tgBotToken: true, tgBotUsername: true, tgSessionEncrypted: true, tgPersonalUsername: true },
      }),
      this.prisma.projectBot.findMany({ where: { projectId, deletedAt: null }, select: { id: true, tgBotUsername: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    if (channel?.type !== 'TELEGRAM') return [];
    return [
      ...(channel.tgBotToken
        ? [{ key: 'BOT', kind: 'BOT' as const, title: channel.tgBotUsername ? `@${channel.tgBotUsername}` : 'Основной бот', connected: true }]
        : []),
      ...extraBots.map((b) => ({ key: `BOT:${b.id}`, kind: 'EXTRA_BOT' as const, title: b.tgBotUsername ? `@${b.tgBotUsername}` : 'Бот', connected: true })),
      {
        key: 'PERSONAL',
        kind: 'PERSONAL' as const,
        title: channel.tgPersonalUsername ? `Личка @${channel.tgPersonalUsername}` : 'Личка',
        connected: !!channel.tgSessionEncrypted,
      },
    ];
  }

  async get(projectId: string, companyId: string, user: AuthUser) {
    await this.projectsService.assertCanManageProjectOperators(projectId, companyId, user.userId, user.role);
    const [resources, operators, assignments, autoAssign] = await Promise.all([
      this.resources(projectId),
      this.prisma.user.findMany({
        where: { companyId, deletedAt: null, role: UserRole.OPERATOR },
        select: { id: true, firstName: true, lastName: true, email: true, isActive: true, projectAccess: { where: { projectId }, select: { projectId: true } } },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.chatResourceAccess.findMany({ where: { projectId, companyId }, select: { resource: true, userId: true } }),
      this.prisma.chatAutoAssignRule.findMany({ where: { projectId, companyId, weight: { gt: 0 } }, select: { resource: true, userId: true, weight: true } }),
    ]);
    return {
      resources,
      operators: operators.map((o) => ({
        id: o.id,
        name: formatUserName(o) || o.email,
        email: o.email,
        onProject: o.projectAccess.length > 0,
        isActive: o.isActive,
      })),
      assignments,
      autoAssign,
      formerOperators: await this.formerOperators(projectId, companyId),
    };
  }

  // Удалённые и заблокированные, за которыми в проекте ещё числятся диалоги (2026-10-26) — чтобы
  // такие «зависшие» чаты можно было найти фильтром и передать.
  private async formerOperators(projectId: string, companyId: string) {
    const rows = await this.prisma.conversation.groupBy({
      by: ['assignedUserId'],
      where: { projectId, companyId, deletedAt: null, assignedUserId: { not: null } },
      _count: { _all: true },
    });
    if (!rows.length) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.assignedUserId!) }, companyId, OR: [{ deletedAt: { not: null } }, { isActive: false }] },
      select: { id: true, firstName: true, lastName: true, email: true, isActive: true, deletedAt: true },
    });
    return users.map((u) => ({
      id: u.id,
      name: formatUserName(u) || u.email,
      deleted: !!u.deletedAt,
      chats: rows.find((r) => r.assignedUserId === u.id)?._count._all ?? 0,
    }));
  }

  // Авто-распределение новых диалогов ресурса (2026-10-25): доли операторов в процентах, в сумме
  // 100. Пустой список — распределение у ресурса выключено. Оператора, которого нет в проекте,
  // добавляем в проект, как и при выдаче доступа к чатам.
  async setAutoAssign(projectId: string, companyId: string, user: AuthUser, resource: string, rules: { userId: string; weight: number }[]) {
    await this.projectsService.assertCanManageProjectOperators(projectId, companyId, user.userId, user.role);
    if (!(await this.resources(projectId)).some((r) => r.key === resource)) throw new BadRequestException('Такого ресурса у проекта нет');

    const active = rules.filter((r) => r.weight > 0);
    if (new Set(active.map((r) => r.userId)).size !== active.length) throw new BadRequestException('Оператор указан дважды');
    const total = active.reduce((sum, r) => sum + r.weight, 0);
    if (active.length && total !== 100) throw new BadRequestException(`Сумма долей должна быть 100%, сейчас ${total}%`);

    const operators = await this.prisma.user.findMany({
      where: { id: { in: active.map((r) => r.userId) }, companyId, deletedAt: null, role: UserRole.OPERATOR },
      select: { id: true, projectAccess: { where: { projectId }, select: { projectId: true } } },
    });
    if (operators.length !== active.length) throw new BadRequestException('Распределять чаты можно только между операторами компании');
    for (const op of operators) {
      if (op.projectAccess.length === 0) {
        await this.projectsService.addOperatorToProject(projectId, companyId, user.userId, user.role, op.id);
      }
    }
    await this.prisma.$transaction([
      this.prisma.chatAutoAssignRule.deleteMany({ where: { projectId, companyId, resource } }),
      this.prisma.chatAutoAssignRule.createMany({
        data: active.map((r) => ({ companyId, projectId, resource, userId: r.userId, weight: r.weight, createdById: user.userId })),
      }),
    ]);
    return this.get(projectId, companyId, user);
  }

  // Точный список операторов ресурса: кого нет в userIds — снимается, новые — добавляются.
  async set(projectId: string, companyId: string, user: AuthUser, resource: string, userIds: string[]) {
    await this.projectsService.assertCanManageProjectOperators(projectId, companyId, user.userId, user.role);
    if (!(await this.resources(projectId)).some((r) => r.key === resource)) throw new BadRequestException('Такого ресурса у проекта нет');

    const ids = Array.from(new Set(userIds));
    const operators = await this.prisma.user.findMany({
      where: { id: { in: ids }, companyId, deletedAt: null, role: UserRole.OPERATOR },
      select: { id: true, projectAccess: { where: { projectId }, select: { projectId: true } } },
    });
    if (operators.length !== ids.length) throw new BadRequestException('Назначать на чаты можно только операторов компании');

    for (const op of operators) {
      if (op.projectAccess.length === 0) {
        await this.projectsService.addOperatorToProject(projectId, companyId, user.userId, user.role, op.id);
      }
    }
    await this.prisma.$transaction([
      this.prisma.chatResourceAccess.deleteMany({ where: { projectId, companyId, resource, userId: { notIn: ids } } }),
      this.prisma.chatResourceAccess.createMany({
        data: ids.map((userId) => ({ companyId, projectId, userId, resource, createdById: user.userId })),
        skipDuplicates: true,
      }),
    ]);
    return this.get(projectId, companyId, user);
  }
}
