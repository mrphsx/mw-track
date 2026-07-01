import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { PushStatus } from '@prisma/client';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';

@Processor('push-messages')
export class PushesProcessor {
  private readonly logger = new Logger(PushesProcessor.name);

  constructor(
    private prisma: PrismaService,
    private channelsService: ChannelsService,
  ) {}

  @Process('send-push-message')
  async sendPushMessage(job: Job<{ pushId: string; clientId: string }>) {
    const [push, client] = await Promise.all([
      this.prisma.push.findUnique({ where: { id: job.data.pushId } }),
      this.prisma.client.findUnique({ where: { id: job.data.clientId } }),
    ]);
    if (!push || !client) return;

    const log = await this.prisma.pushLog.create({
      data: { pushId: push.id, clientId: client.id, status: 'pending' },
    });

    // 403 (бот заблокирован пользователем) уже обрабатывается внутри
    // TelegramProvider.sendMessage → ClientsService.markBotBlocked (шаг 1.5) —
    // здесь только фиксируем итог в PushLog и счётчиках Push.
    const media = push.messageMedia as { type?: 'photo' | 'video'; url?: string } | null;
    const sent = await this.channelsService.sendMessage(client, {
      text: push.messageText,
      mediaUrl: media?.url,
      mediaType: media?.type,
      buttons: push.buttons as { text: string; url?: string }[] | undefined,
    });

    await this.prisma.pushLog.update({
      where: { id: log.id },
      data: {
        status: sent ? 'sent' : 'failed',
        sentAt: sent ? new Date() : null,
        error: sent ? null : 'send failed',
      },
    });

    // deliveredCount не инкрементируется здесь: Bot API не даёт подтверждения доставки
    // (в отличие от sentCount — это просто "запрос к Telegram прошёл успешно"), а заявлять
    // delivered без реального сигнала было бы вводящей в заблуждение статистикой.
    const updated = await this.prisma.push.update({
      where: { id: push.id },
      data: sent ? { sentCount: { increment: 1 } } : { failedCount: { increment: 1 } },
    });

    if (updated.status === PushStatus.SENDING && updated.sentCount + updated.failedCount >= updated.audienceReachable) {
      await this.prisma.push.update({ where: { id: push.id }, data: { status: PushStatus.SENT } });
    }
  }
}
