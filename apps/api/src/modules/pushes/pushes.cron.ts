import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PushesService } from './pushes.service';

@Injectable()
export class PushesCron {
  private readonly logger = new Logger(PushesCron.name);

  constructor(
    private prisma: PrismaService,
    private pushesService: PushesService,
  ) {}

  @Cron('0 0 * * *') // раз в сутки
  async resetMonthlyPushLimits() {
    await this.pushesService.resetMonthlyPushLimits();
  }

  // SubscriptionGuard (шаг 1.3) уже блокирует доступ в реальном времени по
  // company.planExpiresAt — этому крону не нужно (и не должно) повторять ту проверку.
  // Его задача — то, чего guard не делает: видимость для опс + отключение каналов,
  // чтобы боты не продолжали отвечать клиентам истёкшей компании в фоне
  // (вебхуки публичные, guard их не защищает).
  @Cron('0 * * * *') // каждый час
  async checkExpiredSubscriptions() {
    const expired = await this.prisma.company.findMany({
      where: { planExpiresAt: { lt: new Date() }, plan: { not: 'TRIAL' } },
      include: { projects: { include: { channels: true } } },
    });

    for (const company of expired) {
      this.logger.warn(`Company ${company.id} (${company.name}) subscription expired at ${company.planExpiresAt}`);

      for (const project of company.projects) {
        for (const channel of project.channels) {
          if (channel.isActive) {
            await this.prisma.channel.update({ where: { id: channel.id }, data: { isActive: false } });
          }
        }
      }
    }
  }
}
