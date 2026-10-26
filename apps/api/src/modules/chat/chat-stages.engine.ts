import { Injectable, Logger } from '@nestjs/common';
import { ChatStage, ChatStageOperator, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { formatUserName } from '../../common/user-name.util';
import { chatResourceKey } from './chat-resource.util';

type StageWithOperators = ChatStage & { operators: ChatStageOperator[] };
interface MovableConversation {
  id: string;
  companyId: string;
  projectId: string;
  source: 'BOT' | 'PERSONAL';
  botKey: string;
  stageId: string | null;
  assignedAt: Date | null;
}

const APPLY_BATCH = 200;

// Этапы лида (2026-10-25, по образцу флоу Chatterfy: «один оператор ведёт FD, другой — RD», но не
// строго про депозиты). Живёт в ChatStoreModule без зависимостей, чтобы его могли звать и запись
// переписки (новый диалог), и PurchasesService (покупка), и чат (теги, поля, ручной перевод) — без
// циклов между модулями. Все входы best-effort: сбой этапов не должен ронять ни вебхук бота, ни
// регистрацию покупки.
@Injectable()
export class ChatStagesEngine {
  private readonly logger = new Logger(ChatStagesEngine.name);

  constructor(private prisma: PrismaService) {}

  // Перевод диалога на этап: диалог уходит оператору этапа по долям (прежний оператор его теряет),
  // в переписке — служебная пометка. Без операторов у этапа ответственный не меняется.
  async move(conversation: MovableConversation, stage: StageWithOperators, reason?: string): Promise<boolean> {
    if (conversation.stageId === stage.id) return false;
    const picked = await this.pickOperator(stage);
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        stageId: stage.id,
        ...(picked ? { assignedUserId: picked.id, assignedAt: conversation.assignedAt ?? new Date() } : {}),
      },
    });
    const note = `Этап «${stage.name}»${picked ? ` · передан оператору ${picked.name}` : ''}${reason ? ` · ${reason}` : ''}`;
    await this.prisma.chatMessage.create({ data: { conversationId: conversation.id, direction: 'OUT', senderType: 'SYSTEM', text: note } });
    return true;
  }

  private async pickOperator(stage: StageWithOperators): Promise<{ id: string; name: string } | null> {
    const rules = stage.operators.filter((o) => o.weight > 0);
    if (!rules.length) return null;
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: rules.map((r) => r.userId) },
        companyId: stage.companyId,
        deletedAt: null,
        isActive: true,
        role: 'OPERATOR',
        projectAccess: { some: { projectId: stage.projectId } },
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const pool = rules.filter((r) => users.some((u) => u.id === r.userId));
    const total = pool.reduce((s, r) => s + r.weight, 0);
    if (total <= 0) return null;
    let roll = Math.random() * total;
    const chosen = pool.find((r) => (roll -= r.weight) < 0) ?? pool[pool.length - 1];
    const user = users.find((u) => u.id === chosen.userId)!;
    return { id: user.id, name: formatUserName(user) || user.email };
  }

  // Этапы ресурса диалога — у бота и лички свои (2026-10-25).
  private stages(conversation: Pick<MovableConversation, 'projectId' | 'source' | 'botKey'>, where: Prisma.ChatStageWhereInput) {
    return this.prisma.chatStage.findMany({ where: { projectId: conversation.projectId, resource: chatResourceKey(conversation), ...where }, include: { operators: true }, orderBy: { sortOrder: 'desc' } });
  }

  // Новый диалог — на этап «Новый диалог» (первый по порядку). true — перевели, значит обычное
  // авто-распределение ресурса уже не нужно.
  async onNewConversation(conversation: MovableConversation): Promise<boolean> {
    try {
      const [stage] = await this.prisma.chatStage.findMany({
        where: { projectId: conversation.projectId, resource: chatResourceKey(conversation), trigger: 'NEW_CHAT' },
        include: { operators: true },
        orderBy: { sortOrder: 'asc' },
        take: 1,
      });
      return stage ? await this.move(conversation, stage) : false;
    } catch (error) {
      this.logger.warn(`onNewConversation ${conversation.id}: ${(error as Error).message}`);
      return false;
    }
  }

  // Покупка клиента: n — её номер (1 — первая). Повторная с точным номером важнее «любой повторной»,
  // при равенстве — этап ниже по списку. Переводятся все диалоги клиента в проекте (бот и личка).
  async onPurchase(projectId: string, clientId: string, n: number): Promise<void> {
    try {
      // У каждого диалога клиента (бот, личка) — этап его собственного ресурса.
      const conversations = await this.prisma.conversation.findMany({ where: { projectId, clientId, deletedAt: null } });
      for (const c of conversations) {
        const candidates =
          n === 1
            ? await this.stages(c, { trigger: 'FIRST_PURCHASE' })
            : await this.stages(c, { trigger: 'REPEAT_PURCHASE', OR: [{ purchaseNumber: null }, { purchaseNumber: n }] });
        const stage = candidates.find((s) => s.purchaseNumber === n) ?? candidates[0];
        if (stage) await this.move(c, stage, n === 1 ? 'первая покупка' : `покупка №${n}`);
      }
    } catch (error) {
      this.logger.warn(`onPurchase ${clientId}: ${(error as Error).message}`);
    }
  }

  async onTagsAdded(conversation: MovableConversation, tagIds: string[]): Promise<void> {
    if (!tagIds.length) return;
    try {
      const [stage] = await this.stages(conversation, { trigger: 'TAG', tagId: { in: tagIds } });
      if (stage) await this.move(conversation, stage, 'поставлен тег');
    } catch (error) {
      this.logger.warn(`onTagsAdded ${conversation.id}: ${(error as Error).message}`);
    }
  }

  async onFieldSet(conversation: MovableConversation, fieldId: string, value: unknown): Promise<void> {
    try {
      const candidates = await this.stages(conversation, { trigger: 'FIELD', fieldId });
      const stage = candidates.find((s) => fieldMatches(value, s.fieldValue));
      if (stage) await this.move(conversation, stage, 'заполнено поле');
    } catch (error) {
      this.logger.warn(`onFieldSet ${conversation.id}: ${(error as Error).message}`);
    }
  }

  // «Разложить сразу» (решение пользователя 2026-10-25): все уже подходящие под условие этапа
  // диалоги проекта переводятся на него. Покупки — по уже накопленному числу покупок клиента.
  async applyToExisting(stage: StageWithOperators): Promise<number> {
    let where: Prisma.ConversationWhereInput;
    switch (stage.trigger) {
      case 'NEW_CHAT':
        where = { stageId: null };
        break;
      case 'FIRST_PURCHASE':
      case 'REPEAT_PURCHASE': {
        const purchasesCount = stage.trigger === 'FIRST_PURCHASE' ? 1 : { gte: stage.purchaseNumber ?? 2 };
        const clients = await this.prisma.client.findMany({ where: { projectId: stage.projectId, deletedAt: null, purchasesCount }, select: { id: true } });
        where = { clientId: { in: clients.map((c) => c.id) } };
        break;
      }
      case 'TAG':
        if (!stage.tagId) return 0;
        where = { id: { in: (await this.prisma.conversationTag.findMany({ where: { tagId: stage.tagId }, select: { conversationId: true } })).map((t) => t.conversationId) } };
        break;
      case 'FIELD': {
        if (!stage.fieldId || !stage.fieldValue) return 0;
        const rows = await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Conversation"
          WHERE "projectId" = ${stage.projectId} AND "deletedAt" IS NULL
            AND ("customFields"->>${stage.fieldId} ILIKE ${stage.fieldValue} OR "customFields"->${stage.fieldId} @> to_jsonb(${stage.fieldValue}::text))`;
        where = { id: { in: rows.map((r) => r.id) } };
        break;
      }
      default:
        return 0;
    }
    let moved = 0;
    for (;;) {
      const batch = await this.prisma.conversation.findMany({
        where: { AND: [where, resourceWhere(stage.resource), { projectId: stage.projectId, deletedAt: null, OR: [{ stageId: null }, { stageId: { not: stage.id } }] }] },
        take: APPLY_BATCH,
      });
      if (!batch.length) break;
      for (const c of batch) if (await this.move(c, stage, 'разложено по условию этапа')) moved++;
      if (batch.length < APPLY_BATCH) break;
    }
    return moved;
  }
}

// Диалоги ресурса этапа: основной бот, дополнительный бот или личка.
function resourceWhere(resource: string): Prisma.ConversationWhereInput {
  if (resource === 'PERSONAL') return { source: 'PERSONAL' };
  return { source: 'BOT', botKey: resource.startsWith('BOT:') ? resource.slice(4) : '' };
}

function fieldMatches(value: unknown, expected: string | null): boolean {
  if (!expected) return false;
  const want = expected.trim().toLowerCase();
  if (Array.isArray(value)) return value.some((v) => String(v).toLowerCase() === want);
  return value !== null && value !== undefined && String(value).trim().toLowerCase() === want;
}
