import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PersonalBroadcastStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PersonalBroadcastsService } from './personal-broadcasts.service';

const STALL_THRESHOLD_MS = 5 * 60 * 1000;

// Тот же интервал/приём, что PushesCron/StoriesCron: раз в минуту. Два дела за тик: (а)
// запускает broadcast'ы, у которых наступил scheduledAt; (б) восстанавливает "зависшие"
// SENDING broadcast'ы — есть ещё PENDING логи, но ни один не тронут дольше 5 минут (процесс
// упал посреди долгой рассылки, растянутой на паузы между получателями).
@Injectable()
export class PersonalBroadcastsCron {
  private readonly logger = new Logger(PersonalBroadcastsCron.name);

  constructor(
    private prisma: PrismaService,
    private service: PersonalBroadcastsService,
  ) {}

  @Cron('*/1 * * * *')
  async tick(): Promise<void> {
    await this.fireScheduled();
    await this.recoverStalled();
  }

  private async fireScheduled(): Promise<void> {
    const due = await this.prisma.personalBroadcast.findMany({
      where: { status: PersonalBroadcastStatus.SCHEDULED, scheduledAt: { lte: new Date() } },
      select: { id: true },
    });
    for (const b of due) {
      try {
        await this.service.send(b.id);
      } catch (error) {
        this.logger.warn(`fireScheduled: send(${b.id}) failed: ${(error as Error).message}`);
      }
    }
  }

  private async recoverStalled(): Promise<void> {
    const stallThreshold = new Date(Date.now() - STALL_THRESHOLD_MS);
    const sending = await this.prisma.personalBroadcast.findMany({
      where: { status: PersonalBroadcastStatus.SENDING, updatedAt: { lte: stallThreshold } },
      select: { id: true },
    });

    for (const b of sending) {
      const pendingCount = await this.prisma.personalBroadcastLog.count({ where: { broadcastId: b.id, status: 'pending' } });
      if (pendingCount === 0) continue; // всё разослано, процессор просто ещё не дошёл до финального апдейта в SENT

      this.logger.warn(`recoverStalled: re-enqueueing broadcast ${b.id} (${pendingCount} pending)`);
      try {
        await this.service.requeueSending(b.id);
      } catch (error) {
        this.logger.warn(`recoverStalled: requeueSending(${b.id}) failed: ${(error as Error).message}`);
      }
    }
  }
}
