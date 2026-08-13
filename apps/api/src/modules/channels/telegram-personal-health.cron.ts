import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramPersonalService } from './providers/telegram-personal.service';

// Проактивная проверка живости личных MTProto-аккаунтов (запрос пользователя 2026-08-06: "чтобы
// как-то проверялось раз в некоторое время либо при обновлении... уведомление и изменение
// статуса, не тратить сильно ресурсы") — до этого мёртвая сессия (см.
// TelegramPersonalService.handleDeadSession) обнаруживалась ТОЛЬКО реактивно, когда какая-то
// другая операция (открытие папок, отправка рассылки) случайно на неё натыкалась — на
// нетронутом проекте протухшая сессия могла висеть неделями невидимой.
//
// Раз в 30 минут (реже, чем 15-минутный checkAllChannelsHealth у ботов в ChannelsService —
// личных аккаунтов сильно меньше, а сама проверка (getMe) не критична по свежести настолько же,
// насколько webhook-здоровье бота), последовательно (НЕ Promise.all — тот же принцип, что уже
// документирует StoriesCron: один MTProto-сокет на канал не должен получать параллельные
// invoke() от нескольких задач сразу). На реальных масштабах (5 подключённых личных аккаунтов в
// проде на момент реализации) это тривиально дёшево — если вырастет на порядки, здесь может
// понадобиться батчинг/лимит на проверок за тик, сейчас не нужен.
@Injectable()
export class TelegramPersonalHealthCron {
  private readonly logger = new Logger(TelegramPersonalHealthCron.name);

  constructor(
    private prisma: PrismaService,
    private personal: TelegramPersonalService,
  ) {}

  @Cron('*/30 * * * *')
  async checkAllPersonalSessions(): Promise<void> {
    const channels = await this.prisma.channel.findMany({ where: { tgSessionEncrypted: { not: null } } });

    for (const channel of channels) {
      try {
        const healthy = await this.personal.checkSessionHealth(channel);
        if (!healthy) {
          this.logger.warn(`Personal account for channel ${channel.id} failed health check`);
        }
      } catch (error) {
        // checkSessionHealth сам никогда не бросает (см. её комментарий) — эта ветка на случай
        // непредвиденной ошибки в самом цикле (например сбой Prisma), чтобы одна проблемная
        // строка не оборвала проверку остальных каналов в этом тике.
        this.logger.warn(`checkAllPersonalSessions: unexpected error for channel ${channel.id}: ${(error as Error).message}`);
      }
    }
  }
}
