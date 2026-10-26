import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { formatUserName } from '../../common/user-name.util';
import { ProjectsService } from '../projects/projects.service';
import { ChatService } from './chat.service';
import { ChatStoreService } from './chat-store.service';

const MAX_BULK = 200;
const TRANSFER_CHUNK = 500;

export interface TransferTarget {
  userId: string;
  weight: number;
}

// Ответственный за диалог (запрос пользователя 2026-10-25, «как в Chatterfy»): тимлид
// (OPERATOR_ADMIN в своих проектах), админ или владелец передаёт диалог оператору — тот видит его,
// даже если доступа ко всему боту/личке у него нет (ChatService.chatScope). Оператор может только
// вернуть свой чат тимлиду. Права тимлида — те же, что на управление операторами проекта.
@Injectable()
export class ChatAssignmentService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
    private chatService: ChatService,
    private chatStore: ChatStoreService,
  ) {}

  async canAssignIn(projectId: string, companyId: string, user: AuthUser): Promise<boolean> {
    if (user.role === UserRole.OPERATOR) return false;
    try {
      await this.projectsService.assertCanManageProjectOperators(projectId, companyId, user.userId, user.role);
      return true;
    } catch {
      return false;
    }
  }

  // targetUserId = null — снять ответственного (у оператора — «вернуть тимлиду»).
  async assign(conversationIds: string[], targetUserId: string | null, companyId: string, user: AuthUser) {
    const ids = Array.from(new Set(conversationIds));
    if (ids.length === 0) throw new BadRequestException('Не выбраны диалоги');
    if (ids.length > MAX_BULK) throw new BadRequestException(`Не больше ${MAX_BULK} диалогов за раз`);

    const actor = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { firstName: true, lastName: true, email: true } });
    const actorName = actor ? formatUserName(actor) || actor.email : 'Сотрудник';

    const target = targetUserId
      ? await this.prisma.user.findFirst({
          where: { id: targetUserId, companyId, deletedAt: null, isActive: true, role: UserRole.OPERATOR },
          select: { id: true, firstName: true, lastName: true, email: true, projectAccess: { select: { projectId: true } } },
        })
      : null;
    if (targetUserId && !target) throw new BadRequestException('Передать чат можно только действующему оператору компании');
    const targetName = target ? formatUserName(target) || target.email : '';
    const targetProjects = new Set(target?.projectAccess.map((a) => a.projectId) ?? []);
    const checkedProjects = new Set<string>();

    let changed = 0;
    for (const id of ids) {
      // Не видит диалог — 404, как и везде в чате.
      const conversation = await this.chatService.loadConversation(id, companyId, user);

      if (user.role === UserRole.OPERATOR) {
        if (targetUserId !== null || conversation.assignedUserId !== user.userId) {
          throw new ForbiddenException('Оператор может только вернуть свой чат тимлиду');
        }
      } else if (!checkedProjects.has(conversation.projectId)) {
        await this.projectsService.assertCanManageProjectOperators(conversation.projectId, companyId, user.userId, user.role);
        checkedProjects.add(conversation.projectId);
      }

      if (conversation.assignedUserId === targetUserId) continue;

      // Оператора ещё нет в проекте — добавляем обычным путём (ProjectAccess + стандартные права),
      // как и при выдаче доступа к чатам ресурса.
      if (target && !targetProjects.has(conversation.projectId)) {
        await this.projectsService.addOperatorToProject(conversation.projectId, companyId, user.userId, user.role, target.id);
        targetProjects.add(conversation.projectId);
      }

      await this.prisma.conversation.update({
        where: { id },
        data: { assignedUserId: targetUserId, assignedAt: conversation.assignedAt ?? new Date() },
      });
      const note =
        user.role === UserRole.OPERATOR
          ? `${actorName} вернул(а) чат тимлиду`
          : target
            ? `Чат передан оператору ${targetName} · назначил(а) ${actorName}`
            : `Ответственный снят · ${actorName}`;
      await this.chatStore.appendSystemNote(id, note, user.userId);
      changed++;
    }
    return { changed };
  }

  // Проекты, где сотрудник управляет операторами (владелец/админ — все, тимлид — свои).
  private async manageable(projectIds: string[], companyId: string, user: AuthUser): Promise<Set<string>> {
    const ok = new Set<string>();
    for (const projectId of projectIds) if (await this.canAssignIn(projectId, companyId, user)) ok.add(projectId);
    return ok;
  }

  // Сводка для «Передать все чаты оператора» (2026-10-26): сколько диалогов за ним по проектам и
  // каналам — только в проектах, где спрашивающий управляет операторами. Оператор может быть уже
  // удалён или заблокирован: как раз чтобы забрать у него «зависшие» чаты.
  async transferSummary(fromUserId: string, companyId: string, user: AuthUser) {
    if (user.role === UserRole.OPERATOR) throw new ForbiddenException('Передавать чаты может тимлид или админ');
    const from = await this.prisma.user.findFirst({ where: { id: fromUserId, companyId }, select: { id: true, firstName: true, lastName: true, email: true } });
    if (!from) throw new BadRequestException('Сотрудник не найден');
    const rows = await this.prisma.conversation.groupBy({
      by: ['projectId', 'source'],
      where: { companyId, assignedUserId: fromUserId, deletedAt: null },
      _count: { _all: true },
    });
    const allowed = await this.manageable(Array.from(new Set(rows.map((r) => r.projectId))), companyId, user);
    const projects = await this.prisma.project.findMany({ where: { id: { in: Array.from(allowed) }, companyId }, select: { id: true, name: true } });
    const groups = rows
      .filter((r) => allowed.has(r.projectId))
      .map((r) => ({ projectId: r.projectId, projectName: projects.find((p) => p.id === r.projectId)?.name ?? 'Проект', source: r.source, count: r._count._all }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.source.localeCompare(b.source));
    const operators = await this.prisma.user.findMany({
      where: { companyId, deletedAt: null, isActive: true, role: UserRole.OPERATOR, id: { not: fromUserId } },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: { firstName: 'asc' },
    });
    return {
      from: { id: from.id, name: formatUserName(from) || from.email },
      total: groups.reduce((s, g) => s + g.count, 0),
      hidden: rows.filter((r) => !allowed.has(r.projectId)).reduce((s, r) => s + r._count._all, 0),
      groups,
      operators: operators.map((o) => ({ id: o.id, name: formatUserName(o) || o.email })),
    };
  }

  // Передать ВСЕ диалоги оператора (без лимита MAX_BULK): одному оператору, по долям между
  // несколькими или снять ответственного (targets пустой — диалоги уходят в «Без ответственного»).
  // projectId/source сужают выборку. Делится равномерно по долям (не случайно): каждый следующий
  // диалог получает тот, у кого больше всего «недобор» до своей доли.
  async transferAll(
    companyId: string,
    user: AuthUser,
    data: { fromUserId: string; projectId?: string; source?: 'BOT' | 'PERSONAL'; targets: TransferTarget[] },
  ) {
    if (user.role === UserRole.OPERATOR) throw new ForbiddenException('Передавать чаты может тимлид или админ');
    const targets = data.targets.filter((t) => t.weight > 0);
    if (new Set(targets.map((t) => t.userId)).size !== targets.length) throw new BadRequestException('Оператор указан дважды');
    if (targets.some((t) => t.userId === data.fromUserId)) throw new BadRequestException('Нельзя передать чаты тому же оператору');
    const users = targets.length
      ? await this.prisma.user.findMany({
          where: { id: { in: targets.map((t) => t.userId) }, companyId, deletedAt: null, isActive: true, role: UserRole.OPERATOR },
          select: { id: true, firstName: true, lastName: true, email: true, projectAccess: { select: { projectId: true } } },
        })
      : [];
    if (users.length !== targets.length) throw new BadRequestException('Передать чаты можно только действующим операторам компании');

    const conversations = await this.prisma.conversation.findMany({
      where: {
        companyId,
        assignedUserId: data.fromUserId,
        deletedAt: null,
        ...(data.projectId ? { projectId: data.projectId } : {}),
        ...(data.source ? { source: data.source } : {}),
      },
      select: { id: true, projectId: true },
      orderBy: { lastMessageAt: 'desc' },
    });
    const allowed = await this.manageable(Array.from(new Set(conversations.map((c) => c.projectId))), companyId, user);
    const list = conversations.filter((c) => allowed.has(c.projectId));
    if (!list.length) return { changed: 0, perUser: [] };

    // Кто кому: равномерно по долям.
    const total = targets.reduce((s, t) => s + t.weight, 0);
    const given = new Map<string, number>();
    const byTarget = new Map<string | null, typeof list>();
    list.forEach((c, i) => {
      let pick: string | null = null;
      let best = -Infinity;
      for (const t of targets) {
        const deficit = ((i + 1) * t.weight) / total - (given.get(t.userId) ?? 0);
        if (deficit > best) {
          best = deficit;
          pick = t.userId;
        }
      }
      if (pick) given.set(pick, (given.get(pick) ?? 0) + 1);
      const bucket = byTarget.get(pick);
      if (bucket) bucket.push(c);
      else byTarget.set(pick, [c]);
    });

    // Оператора ещё нет в проекте — добавляем обычным путём, как и при передаче одного чата.
    for (const u of users) {
      const has = new Set(u.projectAccess.map((a) => a.projectId));
      for (const projectId of new Set((byTarget.get(u.id) ?? []).map((c) => c.projectId))) {
        if (!has.has(projectId)) await this.projectsService.addOperatorToProject(projectId, companyId, user.userId, user.role, u.id);
      }
    }

    const actor = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { firstName: true, lastName: true, email: true } });
    const actorName = actor ? formatUserName(actor) || actor.email : 'Сотрудник';
    const from = await this.prisma.user.findUnique({ where: { id: data.fromUserId }, select: { firstName: true, lastName: true, email: true } });
    const fromName = from ? formatUserName(from) || from.email : 'оператора';
    const now = new Date();
    let changed = 0;
    for (const [targetId, convs] of byTarget) {
      const target = users.find((u) => u.id === targetId);
      const note = target
        ? `Чат передан от ${fromName} оператору ${formatUserName(target) || target.email} · назначил(а) ${actorName}`
        : `Ответственный ${fromName} снят · ${actorName}`;
      for (let i = 0; i < convs.length; i += TRANSFER_CHUNK) {
        const ids = convs.slice(i, i + TRANSFER_CHUNK).map((c) => c.id);
        // assignedUserId в условии — не перетираем диалог, который успели переназначить параллельно.
        const res = await this.prisma.conversation.updateMany({
          where: { id: { in: ids }, assignedUserId: data.fromUserId },
          data: { assignedUserId: targetId },
        });
        changed += res.count;
        await this.prisma.conversation.updateMany({ where: { id: { in: ids }, assignedUserId: targetId, assignedAt: null }, data: { assignedAt: now } });
        await this.prisma.chatMessage.createMany({
          data: ids.map((conversationId) => ({ conversationId, direction: 'OUT' as const, senderType: 'SYSTEM' as const, senderUserId: user.userId, text: note })),
        });
      }
    }
    return {
      changed,
      perUser: Array.from(byTarget.entries()).map(([userId, convs]) => ({ userId, count: convs.length })),
    };
  }
}
