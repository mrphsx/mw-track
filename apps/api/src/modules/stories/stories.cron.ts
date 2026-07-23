import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StoryPostStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoriesService } from './stories.service';

// Публикация историй, у которых наступило время (запрос пользователя 2026-07-21) — тот же
// интервал/приём, что у PushesCron.fireScheduledPushes: раз в минуту, атомарный claim внутри
// StoriesService.publish() защищает от повторной публикации. "Опубликовать сейчас"
// (scheduledAt: null) технически ждёт этот же тик — максимум ~60 сек задержки, осознанно один
// код-путь вместо отдельного немедленного варианта.
@Injectable()
export class StoriesCron {
  private readonly logger = new Logger(StoriesCron.name);

  constructor(
    private prisma: PrismaService,
    private storiesService: StoriesService,
  ) {}

  @Cron('*/1 * * * *')
  async publishDueStories() {
    const due = await this.prisma.storyPost.findMany({
      where: {
        status: StoryPostStatus.PENDING,
        deletedAt: null,
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
      },
      select: { id: true },
    });
    if (due.length === 0) return;

    // Последовательно, не Promise.all — один и тот же MTProto-коннекшен на канал не должен
    // получать параллельные invoke() от нескольких историй сразу (риск флуда/рейт-лимита).
    for (const story of due) {
      try {
        await this.storiesService.publish(story.id);
      } catch (error) {
        this.logger.warn(`publishDueStories: publish(${story.id}) failed: ${(error as Error).message}`);
      }
    }
  }
}
