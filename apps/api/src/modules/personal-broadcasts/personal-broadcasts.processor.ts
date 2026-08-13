import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { PersonalBroadcastStatus } from '@prisma/client';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramPersonalService } from '../channels/providers/telegram-personal.service';

interface VariantContent {
  messageText: string;
  mediaUrl?: string;
  buttons?: { text: string; url?: string }[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelayMs(minSeconds: number, maxSeconds: number): number {
  const min = Math.min(minSeconds, maxSeconds);
  const max = Math.max(minSeconds, maxSeconds);
  return (min + Math.random() * (max - min)) * 1000;
}

// Один длинный джоб на ВЕСЬ broadcast (не по джобу на получателя, как у PushesProcessor) —
// цикл с await sleep() между итерациями внутри одного джоба, потому что один и тот же
// MTProto-сокет на канал не должен получать параллельные invoke() от нескольких задач сразу
// (риск флуда — тот же принцип, что уже документирует StoriesCron про Stories). Резюмируемо:
// после рестарта процесса джоб перезапустится (BullMQ stalled-job retry), но claim следующей
// PENDING строки просто продолжает с того места, где остановились — не нужен чекпойнт.
@Processor('personal-broadcast-messages')
export class PersonalBroadcastsProcessor {
  private readonly logger = new Logger(PersonalBroadcastsProcessor.name);

  constructor(
    private prisma: PrismaService,
    private personal: TelegramPersonalService,
  ) {}

  @Process('send-broadcast')
  async sendBroadcast(job: Job<{ broadcastId: string }>): Promise<void> {
    const { broadcastId } = job.data;

    const broadcast = await this.prisma.personalBroadcast.findUnique({
      where: { id: broadcastId },
      include: { project: { include: { channel: true } } },
    });
    if (!broadcast || !broadcast.project.channel) return;

    const channel = broadcast.project.channel;
    const variants = broadcast.variants as unknown as VariantContent[];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const current = await this.prisma.personalBroadcast.findUnique({ where: { id: broadcastId }, select: { status: true } });
      if (!current || current.status === PersonalBroadcastStatus.CANCELLED) break;

      // tgUserId читается напрямую со строки лога (снапшот, запрос пользователя 2026-08-06:
      // "пушить не только клиентов из СРМ, но и всех остальных") — раньше шёл через client.tgUserId,
      // что делало отправку невозможной для получателей без строки Client вообще.
      const row = await this.prisma.personalBroadcastLog.findFirst({
        where: { broadcastId, status: 'pending' },
        orderBy: { id: 'asc' },
      });
      if (!row) break; // всё разослано

      // Атомарный claim строки — защита от двойной отправки, если стального джоба подхватили
      // два воркера почти одновременно (BullMQ stalled-job retry).
      const claimed = await this.prisma.personalBroadcastLog.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'sending' },
      });
      if (claimed.count === 0) continue;

      let waitMs = randomDelayMs(broadcast.delayMinSeconds, broadcast.delayMaxSeconds);

      if (!row.tgUserId) {
        await this.finishLog(row.id, 'skipped');
        await this.incrementCounter(broadcastId, 'skippedCount');
      } else {
        const variant = variants[row.variantIndex] ?? variants[0];
        const result = await this.personal.sendDirectMessage(channel, row.tgUserId, {
          text: variant.messageText,
          mediaUrl: variant.mediaUrl,
          buttons: variant.buttons,
        });

        if (result.success) {
          await this.finishLog(row.id, 'sent');
          await this.incrementCounter(broadcastId, 'sentCount');
        } else if (result.floodWaitSeconds) {
          // FloodWait — не провал получателя: возвращаем строку в pending (заберём её же на
          // следующей итерации) и спим ровно столько, сколько попросил сам Telegram, плюс запас.
          await this.prisma.personalBroadcastLog.update({ where: { id: row.id }, data: { status: 'pending' } });
          waitMs = (result.floodWaitSeconds + 5) * 1000;
          this.logger.warn(`FloodWait ${result.floodWaitSeconds}s on broadcast ${broadcastId}, tgUserId ${row.tgUserId}`);
        } else {
          await this.finishLog(row.id, 'failed', result.error);
          await this.incrementCounter(broadcastId, 'failedCount');
        }
      }

      await sleep(waitMs);
    }

    await this.prisma.personalBroadcast.updateMany({
      where: { id: broadcastId, status: PersonalBroadcastStatus.SENDING },
      data: { status: PersonalBroadcastStatus.SENT, sentAt: new Date() },
    });
  }

  private async finishLog(id: string, status: 'sent' | 'failed' | 'skipped', error?: string): Promise<void> {
    await this.prisma.personalBroadcastLog.update({
      where: { id },
      data: { status, error, sentAt: status === 'sent' ? new Date() : undefined },
    });
  }

  private async incrementCounter(broadcastId: string, field: 'sentCount' | 'failedCount' | 'skippedCount'): Promise<void> {
    await this.prisma.personalBroadcast.update({ where: { id: broadcastId }, data: { [field]: { increment: 1 } } });
  }
}
