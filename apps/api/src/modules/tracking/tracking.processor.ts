import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { PixelPlatform, Prisma } from '@prisma/client';
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

    // Если клик пришёл по сгенерированной ссылке с конкретным пикселем (Client/Landing.
    // "Получить ссылку", запрос пользователя 2026-07-04) — событие роутится ТОЛЬКО туда,
    // не всем активным пикселям проекта. Осознанно без фоллбэка на broadcast, если этот
    // пиксель деактивирован/удалён: раз баер явно выбрал пиксель для этой ссылки, молчаливый
    // откат на "все пиксели" рискует задвоить конверсию в чужой пиксель.
    const pixels = event.pixelId
      ? await this.prisma.trackingPixel.findMany({
          where: { id: event.pixelId, projectId: job.data.projectId, isActive: true },
        })
      : await this.prisma.trackingPixel.findMany({
          where: { projectId: job.data.projectId, isActive: true },
        });

    const results = await Promise.allSettled(
      pixels.map(async (pixel) => {
        const provider = this.providers[pixel.platform];
        const result = await provider.sendEvent(event, pixel);
        // warning (запрос пользователя 2026-07-28) — HTTP успешен, но платформа сигналит,
        // что событие могло не долететь по факту (events_received: 0 у FB и т.п.); своей
        // колонки под это в схеме нет — кладём в error с пометкой ⚠, чтобы было видно в
        // Pixel Logs UI, не только в серверных логах, не выдавая at the same time status
        // как настоящую ошибку (HTTP-запрос реально прошёл успешно).
        const errorText = result.error ?? (result.warning ? `⚠ ${result.warning}` : undefined);
        // requestPayload/responsePayload (запрос пользователя 2026-07-28: "сделай как у
        // конкурентов, полностью с отчётом") — реальное тело запроса к платформе и реальный
        // ответ, для показа в Pixel Logs UI (не только внутренний TrackingEvent.payload, как
        // было раньше). Undefined -> Prisma.JsonNull, а не литеральный undefined (Prisma не
        // принимает undefined в Json-поле update/create так же, как null).
        const requestPayload = (result.requestPayload as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull;
        const responsePayload = (result.responsePayload as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull;
        await this.prisma.trackingEventDelivery.upsert({
          where: { eventId_pixelId: { eventId: event.id, pixelId: pixel.id } },
          create: {
            eventId: event.id,
            pixelId: pixel.id,
            status: result.success ? 'sent' : 'error',
            externalEventId: result.externalEventId,
            error: errorText,
            requestPayload,
            responsePayload,
            httpStatus: result.httpStatus,
          },
          update: {
            status: result.success ? 'sent' : 'error',
            externalEventId: result.externalEventId,
            error: errorText,
            requestPayload,
            responsePayload,
            httpStatus: result.httpStatus,
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
