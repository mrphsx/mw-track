import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChatStageTrigger, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { ChatService } from './chat.service';
import { ChatStagesEngine } from './chat-stages.engine';
import { chatResourceKey } from './chat-resource.util';

export interface StageInput {
  name: string;
  color?: string;
  trigger: ChatStageTrigger;
  purchaseNumber?: number | null;
  tagId?: string | null;
  fieldId?: string | null;
  fieldValue?: string | null;
  operators: { userId: string; weight: number }[];
}

const MAX_STAGES = 20;

// Настройка этапов лида проекта (2026-10-25) — тимлид, админ, владелец. Перевод диалога на этап и
// выбор оператора — в ChatStagesEngine.
@Injectable()
export class ChatStagesService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
    private chatService: ChatService,
    private engine: ChatStagesEngine,
  ) {}

  private async canManage(projectId: string, companyId: string, user: AuthUser) {
    try {
      await this.projectsService.assertCanManageProjectOperators(projectId, companyId, user.userId, user.role);
      return true;
    } catch {
      return false;
    }
  }

  private async assertManage(projectId: string, companyId: string, user: AuthUser) {
    if (!(await this.canManage(projectId, companyId, user))) throw new ForbiddenException('Этапы настраивает тимлид или админ');
  }

  // Этапы ресурса — у бота и лички свои (2026-10-25).
  async list(projectId: string, resource: string, companyId: string, user: AuthUser) {
    if (!(await this.chatService.canSeeProjectChats(companyId, user, projectId))) throw new NotFoundException('Проект не найден');
    const stages = await this.prisma.chatStage.findMany({
      where: { projectId, companyId, resource },
      include: { operators: { select: { userId: true, weight: true } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const counts = await this.prisma.conversation.groupBy({ by: ['stageId'], where: { projectId, deletedAt: null, stageId: { in: stages.map((s) => s.id) } }, _count: true });
    return {
      canManage: await this.canManage(projectId, companyId, user),
      stages: stages.map((s) => ({ ...s, count: counts.find((c) => c.stageId === s.id)?._count ?? 0 })),
    };
  }

  private async validate(projectId: string, resource: string, companyId: string, user: AuthUser, input: StageInput) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Введите название этапа');
    if (input.trigger === 'TAG' && !(input.tagId && (await this.prisma.chatTag.findFirst({ where: { id: input.tagId, projectId, resource } })))) {
      throw new BadRequestException('Выберите тег для этапа');
    }
    if (input.trigger === 'FIELD') {
      if (!(input.fieldId && (await this.prisma.chatCustomField.findFirst({ where: { id: input.fieldId, projectId, resource } })))) throw new BadRequestException('Выберите поле для этапа');
      if (!input.fieldValue?.trim()) throw new BadRequestException('Укажите значение поля');
    }
    const active = input.operators.filter((o) => o.weight > 0);
    if (new Set(active.map((o) => o.userId)).size !== active.length) throw new BadRequestException('Оператор указан дважды');
    const total = active.reduce((s, o) => s + o.weight, 0);
    if (active.length && total !== 100) throw new BadRequestException(`Сумма долей операторов должна быть 100%, сейчас ${total}%`);
    const operators = await this.prisma.user.findMany({
      where: { id: { in: active.map((o) => o.userId) }, companyId, deletedAt: null, role: UserRole.OPERATOR },
      select: { id: true, projectAccess: { where: { projectId }, select: { projectId: true } } },
    });
    if (operators.length !== active.length) throw new BadRequestException('На этап можно поставить только операторов компании');
    // Оператора, которого нет в проекте, добавляем в проект — как при выдаче доступа к чатам.
    for (const op of operators) {
      if (op.projectAccess.length === 0) await this.projectsService.addOperatorToProject(projectId, companyId, user.userId, user.role, op.id);
    }
    return {
      name,
      color: /^#[0-9a-fA-F]{6}$/.test(input.color ?? '') ? input.color! : '#1F4E9C',
      trigger: input.trigger,
      purchaseNumber: input.trigger === 'REPEAT_PURCHASE' && input.purchaseNumber && input.purchaseNumber >= 2 ? input.purchaseNumber : null,
      tagId: input.trigger === 'TAG' ? input.tagId! : null,
      fieldId: input.trigger === 'FIELD' ? input.fieldId! : null,
      fieldValue: input.trigger === 'FIELD' ? input.fieldValue!.trim() : null,
      operators: active,
    };
  }

  async create(projectId: string, resource: string, companyId: string, user: AuthUser, input: StageInput) {
    await this.assertManage(projectId, companyId, user);
    if ((await this.prisma.chatStage.count({ where: { projectId, resource } })) >= MAX_STAGES) throw new BadRequestException(`Не больше ${MAX_STAGES} этапов`);
    const { operators, ...data } = await this.validate(projectId, resource, companyId, user, input);
    const last = await this.prisma.chatStage.findFirst({ where: { projectId, resource }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    return this.prisma.chatStage.create({
      data: { ...data, companyId, projectId, resource, sortOrder: (last?.sortOrder ?? -1) + 1, operators: { create: operators } },
    });
  }

  private async load(stageId: string, projectId: string, companyId: string) {
    const stage = await this.prisma.chatStage.findFirst({ where: { id: stageId, projectId, companyId }, include: { operators: true } });
    if (!stage) throw new NotFoundException('Этап не найден');
    return stage;
  }

  async update(projectId: string, stageId: string, companyId: string, user: AuthUser, input: StageInput) {
    await this.assertManage(projectId, companyId, user);
    const existing = await this.load(stageId, projectId, companyId);
    const { operators, ...data } = await this.validate(projectId, existing.resource, companyId, user, input);
    await this.prisma.$transaction([
      this.prisma.chatStageOperator.deleteMany({ where: { stageId } }),
      this.prisma.chatStage.update({ where: { id: stageId }, data: { ...data, operators: { create: operators } } }),
    ]);
    return this.load(stageId, projectId, companyId);
  }

  // Диалоги удалённого этапа остаются у своих операторов, просто без этапа.
  async remove(projectId: string, stageId: string, companyId: string, user: AuthUser) {
    await this.assertManage(projectId, companyId, user);
    await this.load(stageId, projectId, companyId);
    await this.prisma.$transaction([
      this.prisma.conversation.updateMany({ where: { projectId, stageId }, data: { stageId: null } }),
      this.prisma.chatStage.delete({ where: { id: stageId } }),
    ]);
    return { ok: true };
  }

  async reorder(projectId: string, resource: string, companyId: string, user: AuthUser, ids: string[]) {
    await this.assertManage(projectId, companyId, user);
    const stages = await this.prisma.chatStage.findMany({ where: { projectId, companyId, resource }, select: { id: true } });
    if (stages.length !== ids.length || stages.some((s) => !ids.includes(s.id))) throw new BadRequestException('Передайте все этапы проекта');
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.chatStage.update({ where: { id }, data: { sortOrder: i } })));
    return { ok: true };
  }

  async apply(projectId: string, stageId: string, companyId: string, user: AuthUser) {
    await this.assertManage(projectId, companyId, user);
    const stage = await this.load(stageId, projectId, companyId);
    if (stage.trigger === 'MANUAL') throw new BadRequestException('У этапа нет условия — лидов на него переводят вручную');
    return { moved: await this.engine.applyToExisting(stage) };
  }

  // Сводка «кто ведёт лидов» для полосы над чатами (2026-10-25): правило для новых чатов ресурса
  // (этап «Новый диалог», если он есть, иначе авто-распределение ресурса), остальные этапы с их
  // операторами и долями, и сколько диалогов ресурса сейчас ведёт каждый оператор.
  async distribution(projectId: string, companyId: string, user: AuthUser, source: 'BOT' | 'PERSONAL') {
    await this.assertManage(projectId, companyId, user);
    const resource = source === 'PERSONAL' ? 'PERSONAL' : 'BOT';
    const [stages, autoAssign, operators, counts] = await Promise.all([
      this.prisma.chatStage.findMany({
        where: { projectId, companyId, resource },
        include: { operators: { select: { userId: true, weight: true } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.chatAutoAssignRule.findMany({ where: { projectId, companyId, resource, weight: { gt: 0 } }, select: { userId: true, weight: true } }),
      this.prisma.user.findMany({
        where: { companyId, deletedAt: null, role: UserRole.OPERATOR },
        select: { id: true, firstName: true, lastName: true, email: true, isActive: true, projectAccess: { where: { projectId }, select: { projectId: true } } },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.conversation.groupBy({
        by: ['assignedUserId'],
        where: { projectId, source, botKey: '', deletedAt: null, assignedUserId: { not: null } },
        _count: true,
      }),
    ]);
    const newChatStage = stages.find((s) => s.trigger === 'NEW_CHAT') ?? null;
    return {
      resource,
      // Что сейчас срабатывает на новые чаты.
      newChats: newChatStage
        ? { kind: 'stage' as const, stageId: newChatStage.id, stageName: newChatStage.name, operators: newChatStage.operators }
        : { kind: 'auto' as const, operators: autoAssign },
      stages: stages.map((s) => ({ id: s.id, name: s.name, color: s.color, trigger: s.trigger, purchaseNumber: s.purchaseNumber, operators: s.operators })),
      operators: operators.map((o) => ({
        id: o.id,
        name: [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email,
        isActive: o.isActive,
        onProject: o.projectAccess.length > 0,
        activeChats: counts.find((c) => c.assignedUserId === o.id)?._count ?? 0,
      })),
    };
  }

  // Только операторы и доли этапа — для быстрой правки из полосы над чатами (остальное без изменений).
  async setStageOperators(projectId: string, stageId: string, companyId: string, user: AuthUser, operators: { userId: string; weight: number }[]) {
    const stage = await this.load(stageId, projectId, companyId);
    return this.update(projectId, stageId, companyId, user, {
      name: stage.name,
      color: stage.color,
      trigger: stage.trigger,
      purchaseNumber: stage.purchaseNumber,
      tagId: stage.tagId,
      fieldId: stage.fieldId,
      fieldValue: stage.fieldValue,
      operators,
    });
  }

  // Ручной перевод диалога на этап — любой, кто ведёт диалог (как смена флоу у оператора Chatterfy).
  async setConversationStage(conversationId: string, stageId: string | null, companyId: string, user: AuthUser) {
    const conversation = await this.chatService.loadConversation(conversationId, companyId, user);
    if (!stageId) {
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { stageId: null } });
      return { stageId: null };
    }
    const stage = await this.load(stageId, conversation.projectId, companyId);
    if (stage.resource !== chatResourceKey(conversation)) throw new BadRequestException('Этот этап относится к другому боту/личке');
    const author = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { firstName: true, lastName: true } });
    await this.engine.move(conversation, stage, `вручную${author ? `: ${[author.firstName, author.lastName].filter(Boolean).join(' ')}` : ''}`);
    return { stageId };
  }
}
