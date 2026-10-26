import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { ChatTemplatesService } from './chat-templates.service';
import { chatResourceKey } from './chat-resource.util';

const MAX_AHEAD_MS = 60 * 24 * 60 * 60 * 1000; // 60 дней
const BATCH = 30;

// Отложенные сообщения в чате (2026-10-25, как в Chatterfy): оператор выбирает дату и время,
// сообщение (текст и/или шаблон) уходит само. Отправка — раз в минуту, от имени создателя и с его
// правами на момент отправки: если доступ к чату у него отобрали, сообщение не уйдёт (FAILED с
// причиной). Захват строки условным апдейтом PENDING → SENDING, чтобы ни одно не ушло дважды.
@Injectable()
export class ChatScheduledService {
  private readonly logger = new Logger(ChatScheduledService.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private chatService: ChatService,
    private templates: ChatTemplatesService,
  ) {}

  async create(conversationId: string, companyId: string, user: AuthUser, data: { text?: string; templateId?: string; sendAt: string }) {
    const conversation = await this.chatService.loadConversation(conversationId, companyId, user, true);
    const text = data.text?.trim() || null;
    if (!text && !data.templateId) throw new BadRequestException('Пустое сообщение');
    if (text && text.length > 4096) throw new BadRequestException('Сообщение длиннее 4096 символов');
    if (data.templateId) await this.templates.loadUsable(data.templateId, companyId, user, conversation.projectId, chatResourceKey(conversation));
    const sendAt = new Date(data.sendAt);
    if (isNaN(sendAt.getTime())) throw new BadRequestException('Неверные дата и время');
    if (sendAt.getTime() < Date.now() + 30_000) throw new BadRequestException('Время отправки должно быть хотя бы через минуту');
    if (sendAt.getTime() > Date.now() + MAX_AHEAD_MS) throw new BadRequestException('Запланировать можно не дальше чем на 60 дней');
    return this.prisma.chatScheduledMessage.create({
      data: { companyId, conversationId, text, templateId: data.templateId ?? null, sendAt, createdById: user.userId },
    });
  }

  // Ждут отправки + не ушедшие за последние сутки (чтобы оператор увидел причину).
  async list(conversationId: string, companyId: string, user: AuthUser) {
    await this.chatService.loadConversation(conversationId, companyId, user);
    const rows = await this.prisma.chatScheduledMessage.findMany({
      where: {
        conversationId,
        OR: [{ status: { in: ['PENDING', 'SENDING'] } }, { status: 'FAILED', sendAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }],
      },
      orderBy: { sendAt: 'asc' },
    });
    const templateIds = rows.map((r) => r.templateId).filter((v): v is string => !!v);
    const templates = templateIds.length
      ? await this.prisma.chatTemplate.findMany({ where: { id: { in: templateIds } }, select: { id: true, title: true, code: true, mediaKind: true } })
      : [];
    return rows.map((r) => ({ ...r, template: templates.find((t) => t.id === r.templateId) ?? null }));
  }

  async cancel(id: string, companyId: string, user: AuthUser) {
    const row = await this.prisma.chatScheduledMessage.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Сообщение не найдено');
    await this.chatService.loadConversation(row.conversationId, companyId, user, true);
    const updated = await this.prisma.chatScheduledMessage.updateMany({
      where: { id, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'CANCELLED' },
    });
    if (updated.count === 0) throw new BadRequestException('Сообщение уже отправлено или отправляется');
    return { ok: true };
  }

  @Cron('* * * * *')
  async processDue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.prisma.chatScheduledMessage.findMany({
        where: { status: 'PENDING', sendAt: { lte: new Date() } },
        orderBy: { sendAt: 'asc' },
        take: BATCH,
      });
      for (const row of due) {
        const claimed = await this.prisma.chatScheduledMessage.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'SENDING' } });
        if (claimed.count === 0) continue;
        await this.sendOne(row);
      }
    } catch (error) {
      this.logger.error(`processDue failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async sendOne(row: { id: string; companyId: string; conversationId: string; text: string | null; templateId: string | null; createdById: string }) {
    try {
      const creator = await this.prisma.user.findFirst({ where: { id: row.createdById, companyId: row.companyId, deletedAt: null, isActive: true }, select: { id: true, role: true } });
      if (!creator) throw new Error('Сотрудник, который запланировал сообщение, удалён или заблокирован');
      const user: AuthUser = { userId: creator.id, companyId: row.companyId, role: creator.role };
      await this.chatService.loadConversation(row.conversationId, row.companyId, user, true);
      // Шаблон (в т.ч. цепочка из нескольких сообщений) — тем же путём, что и кнопка «Отправить».
      const message = row.templateId
        ? await this.templates.sendTemplate(row.conversationId, row.companyId, user, row.templateId, row.text ?? undefined)
        : await this.chatService.send(row.conversationId, row.companyId, user, { text: row.text ?? undefined });
      if (message.error) throw new Error(message.error);
      await this.prisma.chatScheduledMessage.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), error: null } });
    } catch (error) {
      const reason = (error as Error).message || 'Не удалось отправить';
      this.logger.warn(`scheduled message ${row.id} failed: ${reason}`);
      await this.prisma.chatScheduledMessage.update({ where: { id: row.id }, data: { status: 'FAILED', error: reason.slice(0, 500) } }).catch(() => {});
    }
  }
}
