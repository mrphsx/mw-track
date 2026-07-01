import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { PixelPlatform } from '@prisma/client';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { FacebookCAPIService } from './facebook-capi.service';
import { TikTokEventsService } from './tiktok-events.service';
import { PixelProvider } from './providers/pixel.provider.interface';

@Processor('tracking-events')
export class TrackingProcessor {
  private readonly logger = new Logger(TrackingProcessor.name);

  // Карта провайдер-на-платформу вместо if/else — тот же паттерн, что
  // ChannelsService.providers для каналов. Новая платформа = новый класс
  // + одна строка в этой карте, без правок остальной логики.
  private readonly providers: Record<PixelPlatform, PixelProvider>;

  constructor(
    private prisma: PrismaService,
    facebookCAPI: FacebookCAPIService,
    tiktokEvents: TikTokEventsService,
  ) {
    this.providers = { FACEBOOK: facebookCAPI, TIKTOK: tiktokEvents };
  }

  @Process('send-to-platforms')
  async sendToPlatforms(job: Job<{ eventDbId: string; projectId: string }>) {
    const event = await this.prisma.trackingEvent.findUnique({ where: { id: job.data.eventDbId } });
    if (!event) return;

    // Проект не привязан к конкретной платформе — событие уходит на все
    // активные пиксели проекта разом (любое число, любых платформ).
    const pixels = await this.prisma.trackingPixel.findMany({
      where: { projectId: job.data.projectId, isActive: true },
    });

    const results = await Promise.allSettled(
      pixels.map(async (pixel) => {
        const provider = this.providers[pixel.platform];
        const result = await provider.sendEvent(event, pixel);
        await this.prisma.trackingEventDelivery.upsert({
          where: { eventId_pixelId: { eventId: event.id, pixelId: pixel.id } },
          create: {
            eventId: event.id,
            pixelId: pixel.id,
            status: result.success ? 'sent' : 'error',
            externalEventId: result.externalEventId,
            error: result.error,
          },
          update: {
            status: result.success ? 'sent' : 'error',
            externalEventId: result.externalEventId,
            error: result.error,
            sentAt: new Date(),
          },
        });
      }),
    );

    for (const r of results) {
      if (r.status === 'rejected') this.logger.warn(`Tracking dispatch failed for event ${event.id}: ${r.reason}`);
    }
  }
}
