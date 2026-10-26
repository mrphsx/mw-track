import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ChatBroadcast, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { formatUserName } from '../../common/user-name.util';
import { ProjectsService } from '../projects/projects.service';
import { ChatService, ConversationListFilters } from './chat.service';
import { randomUUID } from 'crypto';
import { CHAIN_DELAY_MS, ChatTemplatesService, TEMPLATE_MEDIA_KINDS, TemplateMediaKind } from './chat-templates.service';

const MAX_RECIPIENTS = 20000;
const MAX_AHEAD_MS = 60 * 24 * 60 * 60 * 1000;
// Бот: ~8 сообщений в секунду — с запасом под лимит Telegram (~30/с на бота, 1/с в один чат).
const BOT_DELAY_MS = 120;
// Личный аккаунт: медленно и неравномерно, как в рассылках с лички, — иначе аккаунт забанят.
const PERSONAL_DELAY_MS: [number, number] = [15_000, 40_000];
// Свой интервал: для лички не чаще раза в 5 секунд — защита аккаунта от бана.
const PERSONAL_MIN_DELAY_SEC = 5;
const MAX_DELAY_SEC = 3600;
const MAX_VARIANTS = 10;

const MAX_PARTS = 10;

// Своё сообщение варианта (2026-10-26: «для рассылки нужна возможность материалы, кружки, войсы»):
// текст и/или файл, загруженный заранее через uploadMedia. Несколько частей уходят цепочкой.
export interface BroadcastPart {
  text?: string | null;
  mediaKind?: TemplateMediaKind | null;
  mediaKey?: string | null;
  mediaFileName?: string | null;
  mediaMime?: string | null;
}

export interface BroadcastVariant {
  text?: string | null;
  templateId?: string | null;
  parts?: BroadcastPart[] | null;
}

// Рассылка прямо из чата (2026-10-25). Получатели фиксируются при создании (выбранные диалоги или
// все по фильтру списка, в пределах видимости создателя). Отправка — по одному сообщению через
// обычную отправку чата (ChatService.send / ChatTemplatesService.sendTemplate) от имени создателя
// с его правами на момент отправки, поэтому каждое сообщение видно в переписке. Одновременно — не
// больше одной рассылки на проект+источник (личный аккаунт не тянет параллельные отправки). Строку
// получателя захватываем PENDING → SENDING; если процесс перезапустился посреди отправки, такие
// строки помечаются «прервано» и повторно НЕ отправляются — лучше недослать одному, чем задвоить.
@Injectable()
export class ChatBroadcastService implements OnModuleInit {
  private readonly logger = new Logger(ChatBroadcastService.name);
  private readonly running = new Map<string, string>(); // ключ проект:источник → id рассылки
  private ticking = false;
  private recovered = false;

  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
    private chatService: ChatService,
    private templates: ChatTemplatesService,
  ) {}

  onModuleInit() {
    // Не ждём минуту после рестарта — продолжаем начатые рассылки сразу.
    setTimeout(() => void this.tick(), 15_000);
  }

  private async assertManage(projectId: string, companyId: string, user: AuthUser) {
    try {
      await this.projectsService.assertCanManageProjectOperators(projectId, companyId, user.userId, user.role);
    } catch {
      throw new ForbiddenException('Рассылку из чата запускает тимлид или админ');
    }
  }

  // Файл для варианта рассылки — кладём в хранилище сразу (как медиа шаблона: войс перекодируется в
  // ogg/opus, кружок — в квадратное видео), в рассылку уходит ключ.
  async uploadMedia(companyId: string, user: AuthUser, projectId: string, file: Express.Multer.File | undefined, kind?: string) {
    if (!projectId) throw new BadRequestException('Не выбран проект');
    await this.assertManage(projectId, companyId, user);
    if (!file) throw new BadRequestException('Файл не получен');
    const requested = kind && (TEMPLATE_MEDIA_KINDS as readonly string[]).includes(kind) ? (kind as TemplateMediaKind) : null;
    return this.templates.storeMedia(companyId, randomUUID().slice(0, 12), file, requested, 'chat-broadcasts');
  }

  async count(companyId: string, user: AuthUser, filters: ConversationListFilters, ids?: string[]) {
    if (!filters.projectId) throw new BadRequestException('Не выбран проект');
    return { count: (await this.chatService.conversationIdsForBroadcast(companyId, user, filters, ids, MAX_RECIPIENTS + 1)).length };
  }

  async create(
    companyId: string,
    user: AuthUser,
    data: {
      filters: ConversationListFilters;
      conversationIds?: string[];
      text?: string;
      templateId?: string;
      variants?: BroadcastVariant[];
      delayMinSec?: number | null;
      delayMaxSec?: number | null;
      filterSnapshot?: Record<string, unknown>;
      sendAt?: string;
    },
  ) {
    const projectId = data.filters.projectId;
    if (!projectId) throw new BadRequestException('Не выбран проект');
    await this.assertManage(projectId, companyId, user);

    // Варианты сообщения: получатели получают их по очереди. Без вариантов — один из text/templateId.
    const rawVariants = data.variants?.length ? data.variants : [{ text: data.text, templateId: data.templateId }];
    if (rawVariants.length > MAX_VARIANTS) throw new BadRequestException(`Не больше ${MAX_VARIANTS} вариантов`);
    const variants = rawVariants.map((v, i) => {
      const label = rawVariants.length > 1 ? `Вариант ${i + 1}: ` : '';
      if (v.parts?.length) {
        if (v.parts.length > MAX_PARTS) throw new BadRequestException(`${label}не больше ${MAX_PARTS} сообщений`);
        const parts = v.parts.map((p, j) => {
          const text = p.text?.trim() || null;
          if (text && text.length > 4096) throw new BadRequestException(`${label}сообщение ${j + 1} длиннее 4096 символов`);
          let media: Required<Omit<BroadcastPart, 'text'>> = { mediaKind: null, mediaKey: null, mediaFileName: null, mediaMime: null };
          if (p.mediaKey) {
            // Только файлы, загруженные этой компанией через uploadMedia.
            if (!p.mediaKey.startsWith(`chat-broadcasts/${companyId}/`) || p.mediaKey.includes('..')) throw new BadRequestException(`${label}файл не найден`);
            const kind = p.mediaKind && (TEMPLATE_MEDIA_KINDS as readonly string[]).includes(p.mediaKind) ? p.mediaKind : 'document';
            media = { mediaKind: kind, mediaKey: p.mediaKey, mediaFileName: p.mediaFileName?.slice(0, 200) || 'file', mediaMime: p.mediaMime?.slice(0, 100) || 'application/octet-stream' };
          }
          if (!text && !media.mediaKey) throw new BadRequestException(`${label}сообщение ${j + 1} пустое`);
          return { text, ...media };
        });
        return { text: null, templateId: null, parts };
      }
      const text = v.text?.trim() || null;
      if (!text && !v.templateId) throw new BadRequestException(`${label}добавьте текст, файл или шаблон`);
      if (text && text.length > 4096) throw new BadRequestException(`${label}текст длиннее 4096 символов`);
      return { text, templateId: v.templateId || null, parts: null };
    });
    for (const v of variants) if (v.templateId) await this.templates.loadUsable(v.templateId, companyId, user, projectId, data.filters.source === 'PERSONAL' ? 'PERSONAL' : 'BOT');

    let delayMinSec: number | null = null;
    let delayMaxSec: number | null = null;
    if (data.delayMinSec != null || data.delayMaxSec != null) {
      delayMinSec = Math.round(Number(data.delayMinSec ?? data.delayMaxSec));
      delayMaxSec = Math.round(Number(data.delayMaxSec ?? data.delayMinSec));
      if (!Number.isFinite(delayMinSec) || !Number.isFinite(delayMaxSec) || delayMinSec < 0 || delayMaxSec < delayMinSec || delayMaxSec > MAX_DELAY_SEC) {
        throw new BadRequestException(`Интервал — от 0 до ${MAX_DELAY_SEC} секунд, «от» не больше «до»`);
      }
      if (data.filters.source === 'PERSONAL' && delayMinSec < PERSONAL_MIN_DELAY_SEC) {
        throw new BadRequestException(`С личного аккаунта — не чаще раза в ${PERSONAL_MIN_DELAY_SEC} секунд, иначе аккаунт могут забанить`);
      }
    }
    const sendAt = data.sendAt ? new Date(data.sendAt) : new Date();
    if (isNaN(sendAt.getTime())) throw new BadRequestException('Неверные дата и время');
    if (sendAt.getTime() > Date.now() + MAX_AHEAD_MS) throw new BadRequestException('Запланировать можно не дальше чем на 60 дней');

    const ids = await this.chatService.conversationIdsForBroadcast(companyId, user, data.filters, data.conversationIds, MAX_RECIPIENTS + 1);
    if (ids.length === 0) throw new BadRequestException('Некому отправлять — нет подходящих диалогов');
    if (ids.length > MAX_RECIPIENTS) throw new BadRequestException(`Не больше ${MAX_RECIPIENTS} получателей за раз — сузьте фильтр`);

    const broadcast = await this.prisma.chatBroadcast.create({
      data: {
        companyId,
        projectId,
        createdById: user.userId,
        text: variants[0].text,
        templateId: variants[0].templateId,
        variants: variants as unknown as Prisma.InputJsonValue,
        delayMinSec,
        delayMaxSec,
        filter: (data.filterSnapshot ?? null) as Prisma.InputJsonValue,
        sendAt,
        total: ids.length,
      },
    });
    for (let i = 0; i < ids.length; i += 1000) {
      await this.prisma.chatBroadcastRecipient.createMany({
        data: ids.slice(i, i + 1000).map((conversationId, j) => ({ broadcastId: broadcast.id, conversationId, variant: (i + j) % variants.length })),
      });
    }
    if (sendAt.getTime() <= Date.now() + 1000) setTimeout(() => void this.tick(), 500);
    return broadcast;
  }

  // source — только рассылки этого ресурса (бот или личка, 2026-10-25: вкладка открывается для
  // выбранного сверху ресурса). Источник берётся из сохранённого фильтра рассылки.
  async list(projectId: string, companyId: string, user: AuthUser, source?: 'BOT' | 'PERSONAL') {
    await this.assertManage(projectId, companyId, user);
    const rows = await this.prisma.chatBroadcast.findMany({
      where: { projectId, companyId, ...(source ? { filter: { path: ['source'], equals: source } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: Array.from(new Set(rows.map((r) => r.createdById))) } }, select: { id: true, firstName: true, lastName: true, email: true } });
    const templateIds = rows
      .flatMap((r) => [r.templateId, ...(((r.variants as BroadcastVariant[] | null) ?? []).map((v) => v.templateId))])
      .filter((v): v is string => !!v);
    const templates = templateIds.length ? await this.prisma.chatTemplate.findMany({ where: { id: { in: templateIds } }, select: { id: true, code: true, title: true } }) : [];
    return rows.map((r) => {
      const u = users.find((x) => x.id === r.createdById);
      const variants = ((r.variants as BroadcastVariant[] | null) ?? [{ text: r.text, templateId: r.templateId }]).map((v) => ({
        text: v.text ?? v.parts?.find((p) => p.text)?.text ?? null,
        template: v.templateId ? templates.find((t) => t.id === v.templateId) ?? null : null,
        parts: (v.parts ?? []).map((p) => ({ text: p.text ?? null, mediaKind: p.mediaKind ?? null })),
      }));
      return { ...r, createdByName: u ? formatUserName(u) || u.email : null, template: templates.find((t) => t.id === r.templateId) ?? null, variants };
    });
  }

  async cancel(id: string, companyId: string, user: AuthUser) {
    const b = await this.prisma.chatBroadcast.findFirst({ where: { id, companyId } });
    if (!b) throw new NotFoundException('Рассылка не найдена');
    await this.assertManage(b.projectId, companyId, user);
    const updated = await this.prisma.chatBroadcast.updateMany({ where: { id, status: { in: ['PENDING', 'RUNNING'] } }, data: { status: 'CANCELLED', finishedAt: new Date() } });
    if (updated.count === 0) throw new BadRequestException('Рассылка уже завершена');
    await this.prisma.chatBroadcastRecipient.updateMany({ where: { broadcastId: id, status: 'PENDING' }, data: { status: 'SKIPPED' } });
    return { ok: true };
  }

  @Cron('* * * * *')
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (!this.recovered) {
        this.recovered = true;
        const stuck = await this.prisma.chatBroadcastRecipient.findMany({ where: { status: 'SENDING' }, select: { id: true, broadcastId: true } });
        for (const r of stuck) {
          await this.prisma.chatBroadcastRecipient.update({ where: { id: r.id }, data: { status: 'FAILED', error: 'Прервано перезапуском сервера — повторно не отправлялось' } });
          await this.prisma.chatBroadcast.update({ where: { id: r.broadcastId }, data: { failed: { increment: 1 } } });
        }
      }
      const due = await this.prisma.chatBroadcast.findMany({
        where: { OR: [{ status: 'RUNNING' }, { status: 'PENDING', sendAt: { lte: new Date() } }] },
        orderBy: { createdAt: 'asc' },
      });
      for (const b of due) {
        if (Array.from(this.running.values()).includes(b.id)) continue;
        const key = await this.lockKey(b);
        if (!key || this.running.has(key)) continue;
        this.running.set(key, b.id);
        void this.run(b).finally(() => this.running.delete(key));
      }
    } catch (error) {
      this.logger.error(`tick failed: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  // Проект + источник первого получателя (рассылка собирается из одного списка, т.е. одного источника).
  private async lockKey(b: ChatBroadcast): Promise<string | null> {
    const r = await this.prisma.chatBroadcastRecipient.findFirst({ where: { broadcastId: b.id }, select: { conversationId: true } });
    if (!r) return `${b.projectId}:none`;
    const c = await this.prisma.conversation.findUnique({ where: { id: r.conversationId }, select: { source: true, botKey: true } });
    return `${b.projectId}:${c?.source ?? 'BOT'}:${c?.botKey ?? ''}`;
  }

  // Свои сообщения варианта — цепочкой, как многосообщенческий шаблон; на ошибке — стоп.
  private async sendParts(conversationId: string, companyId: string, user: AuthUser, parts: BroadcastPart[]) {
    let last: { error?: string | null } | null = null;
    for (const part of parts) {
      if (last?.error) return last;
      if (last) await new Promise((r) => setTimeout(r, CHAIN_DELAY_MS));
      const attachment = part.mediaKey
        ? await this.templates.attachmentOf({ mediaKey: part.mediaKey, mediaKind: part.mediaKind ?? null, mediaFileName: part.mediaFileName ?? null, mediaMime: part.mediaMime ?? null })
        : undefined;
      last = await this.chatService.send(conversationId, companyId, user, { text: part.text ?? undefined, attachment });
    }
    return last;
  }

  private async run(b: ChatBroadcast): Promise<void> {
    try {
      await this.prisma.chatBroadcast.updateMany({ where: { id: b.id, status: 'PENDING' }, data: { status: 'RUNNING', startedAt: new Date() } });
      const creator = await this.prisma.user.findFirst({ where: { id: b.createdById, companyId: b.companyId, deletedAt: null, isActive: true }, select: { id: true, role: true } });
      let processed = 0;
      for (;;) {
        if (processed % 10 === 0) {
          const fresh = await this.prisma.chatBroadcast.findUnique({ where: { id: b.id }, select: { status: true } });
          if (fresh?.status !== 'RUNNING') return;
        }
        const next = await this.prisma.chatBroadcastRecipient.findFirst({ where: { broadcastId: b.id, status: 'PENDING' }, orderBy: { id: 'asc' } });
        if (!next) break;
        const claimed = await this.prisma.chatBroadcastRecipient.updateMany({ where: { id: next.id, status: 'PENDING' }, data: { status: 'SENDING' } });
        if (claimed.count === 0) continue;
        processed++;

        let error: string | null = null;
        let source: string | null = null;
        try {
          if (!creator) throw new Error('Сотрудник, создавший рассылку, удалён или заблокирован');
          const user: AuthUser = { userId: creator.id, companyId: b.companyId, role: creator.role };
          const conversation = await this.chatService.loadConversation(next.conversationId, b.companyId, user, true);
          source = conversation.source;
          const variants = (b.variants as BroadcastVariant[] | null) ?? [];
          const v = variants[next.variant] ?? { text: b.text, templateId: b.templateId };
          const message = v.parts?.length
            ? await this.sendParts(next.conversationId, b.companyId, user, v.parts)
            : v.templateId
              ? await this.templates.sendTemplate(next.conversationId, b.companyId, user, v.templateId, v.text ?? undefined)
              : await this.chatService.send(next.conversationId, b.companyId, user, { text: v.text ?? undefined });
          if (message?.error) error = message.error;
        } catch (e) {
          error = (e as Error).message || 'Не удалось отправить';
        }
        await this.prisma.chatBroadcastRecipient.update({
          where: { id: next.id },
          data: error ? { status: 'FAILED', error: error.slice(0, 300) } : { status: 'SENT', sentAt: new Date() },
        });
        await this.prisma.chatBroadcast.update({ where: { id: b.id }, data: error ? { failed: { increment: 1 } } : { sent: { increment: 1 } } });

        const delay =
          b.delayMinSec != null && b.delayMaxSec != null
            ? (b.delayMinSec + Math.random() * (b.delayMaxSec - b.delayMinSec)) * 1000
            : source === 'PERSONAL'
              ? PERSONAL_DELAY_MS[0] + Math.random() * (PERSONAL_DELAY_MS[1] - PERSONAL_DELAY_MS[0])
              : BOT_DELAY_MS;
        await new Promise((r) => setTimeout(r, delay));
      }
      await this.prisma.chatBroadcast.updateMany({ where: { id: b.id, status: 'RUNNING' }, data: { status: 'DONE', finishedAt: new Date() } });
    } catch (error) {
      this.logger.error(`broadcast ${b.id} failed: ${(error as Error).message}`);
    }
  }
}
