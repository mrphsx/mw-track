import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bull';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { AutomationEngineService } from '../automations/automation-engine.service';
import { TrackEventDto } from './dto/track-event.dto';

export interface RecordEventDto extends TrackEventDto {
  // Заполняются сервером, не приходят от вызывающего напрямую (см. TrackingController)
  ipAddress?: string;
  userAgent?: string;
  source?: 'BROWSER' | 'SERVER' | 'SDK';
  // Внутренние вызовы (TelegramProvider, PurchasesService) уже знают clientId —
  // передают его явно, чтобы не делать лишний resolveClient() запрос по tgUserId/fbclid
  clientId?: string;
  // Какой лендинг привёл — сейчас проставляется только TelegramProvider.handleJoinRequest
  // для PRIVATE_CHANNEL_REQUEST (единственный режим, где это надёжно определимо, см.
  // Landing.tgInviteLink). Не часть публичного TrackEventDto — браузерный SDK не знает
  // свой landingId, только project publicToken.
  landingId?: string;
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('tracking-events') private trackingQueue: Queue,
    private automationEngine: AutomationEngineService,
  ) {}

  async recordEvent(projectId: string, dto: RecordEventDto): Promise<{ eventId: string }> {
    const eventId = dto.idempotencyKey || `${projectId}_${dto.eventName}_${dto.fbclid || ''}_${Date.now()}_${nanoid(8)}`;

    const existing = await this.prisma.trackingEvent.findUnique({ where: { eventId } });
    if (existing) return { eventId };

    let clientId = dto.clientId;
    if (!clientId && (dto.tgUserId || dto.fbclid)) {
      const client = await this.resolveClient(projectId, dto);
      clientId = client?.id;
    }

    // Атрибуция для роутинга к пикселю/разбивки по рекламе — баг найден 2026-07-21 (вопрос
    // пользователя про диалог с клиентом без рекламной атрибуции, подтверждаемый менеджером):
    // серверные события (Subscribe/Dialogue из TelegramProvider/ClientsService, Purchase из
    // PurchasesService) никогда не передавали сюда pixelId/adId и т.п. явно — только fbclid/
    // ttclid, и то не все вызывающие. Из-за этого КАЖДОЕ такое событие транслировалось во ВСЕ
    // активные пиксели проекта (см. TrackingProcessor.sendToPlatforms — pixelId: null значит
    // broadcast), даже когда у клиента в базе есть точная атрибуция, и даже когда у него нет
    // вообще никакой. Теперь недостающие поля подтягиваются из самого Client (приоритет —
    // явно переданному в dto, оно точнее в моменте, например у Purchase/SDK).
    const attribution = await this.resolveAttribution(clientId, dto);

    let event;
    try {
      event = await this.prisma.trackingEvent.create({
        data: {
          projectId,
          clientId,
          eventName: dto.eventName,
          eventId,
          eventTime: dto.timestamp ? new Date(dto.timestamp) : new Date(),
          source: dto.source || 'SERVER',
          payload: {
            fbclid: attribution.fbclid,
            ttclid: attribution.ttclid,
            email: dto.email,
            phone: dto.phone,
            ipAddress: dto.ipAddress,
            userAgent: dto.userAgent,
            pageUrl: dto.pageUrl,
            value: dto.value,
            currency: dto.currency,
            orderId: dto.orderId,
            utmSource: dto.utmSource,
            utmCampaign: dto.utmCampaign,
            landingId: dto.landingId,
          },
          // Реальные колонки (не только payload) — для роутинга к конкретному пикселю
          // (TrackingProcessor) и индексируемой разбивки по рекламе/кампании (запрос
          // пользователя 2026-07-04).
          pixelId: attribution.pixelId,
          adId: attribution.adId,
          adName: attribution.adName,
          adsetId: attribution.adsetId,
          adsetName: attribution.adsetName,
          campaignId: attribution.campaignId,
          campaignName: attribution.campaignName,
          placement: attribution.placement,
          siteSourceName: attribution.siteSourceName,
        },
      });
    } catch (error) {
      // Гонка: два конкурентных запроса с одним eventId прошли findUnique одновременно
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { eventId };
      }
      throw error;
    }

    // Запрос пользователя 2026-07-21: событие совсем без рекламной атрибуции (ни пикселя, ни
    // fbclid/ttclid, ни ad_id) не должно уходить в Facebook/TikTok "на всякий случай" во все
    // активные пиксели проекта — это ложно приписывает конверсию рекламе, с которой у человека
    // не было контакта. Сама запись в CRM (строка выше) и автоворонки (ниже) от этого не
    // зависят — только фактическая отправка на рекламные платформы.
    const hasAdAttribution = !!(attribution.pixelId || attribution.fbclid || attribution.ttclid || attribution.adId);
    if (hasAdAttribution) {
      await this.trackingQueue.add(
        'send-to-platforms',
        { eventDbId: event.id, projectId },
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          priority: dto.eventName === 'Purchase' ? 1 : 3,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    }

    // Точка врезки автоворонок (Фаза 3.1, запрос пользователя 2026-07-15) — единственное место,
    // куда стекаются все события (Subscribe/Purchase/Dialogue), поэтому единственный вызов
    // здесь покрывает все триггеры сразу, без правок в TelegramProvider/PurchasesService/
    // ClientsService. Без известного clientId запись в воронку не имеет смысла — оборачиваем
    // в try/catch, сбой автоворонки не должен ронять сам трекинг.
    if (clientId) {
      try {
        await this.automationEngine.handleTriggerEvent(projectId, dto.eventName, clientId);
      } catch (error) {
        this.logger.warn(`AutomationEngine.handleTriggerEvent failed: ${(error as Error).message}`);
      }
    }

    return { eventId };
  }

  private async resolveClient(projectId: string, dto: RecordEventDto) {
    if (dto.tgUserId) {
      return this.prisma.client.findFirst({ where: { projectId, tgUserId: dto.tgUserId } });
    }
    if (dto.fbclid) {
      return this.prisma.client.findFirst({ where: { projectId, fbclid: dto.fbclid } });
    }
    return null;
  }

  // Приоритет — явным полям dto (SDK/трекинг-ссылка знает точнее в моменте события), недостающие
  // подтягиваются из Client, если он уже известен. См. комментарий в recordEvent выше.
  private async resolveAttribution(clientId: string | undefined, dto: RecordEventDto) {
    const explicit = {
      pixelId: dto.pixelId,
      adId: dto.adId,
      adName: dto.adName,
      adsetId: dto.adsetId,
      adsetName: dto.adsetName,
      campaignId: dto.campaignId,
      campaignName: dto.campaignName,
      placement: dto.placement,
      siteSourceName: dto.siteSourceName,
      fbclid: dto.fbclid,
      ttclid: dto.ttclid,
    };
    if (!clientId || Object.values(explicit).every((v) => v !== undefined)) return explicit;

    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: {
        pixelId: true,
        adId: true,
        adName: true,
        adsetId: true,
        adsetName: true,
        campaignId: true,
        campaignName: true,
        placement: true,
        siteSourceName: true,
        fbclid: true,
        ttclid: true,
      },
    });
    if (!client) return explicit;

    return {
      pixelId: explicit.pixelId ?? client.pixelId ?? undefined,
      adId: explicit.adId ?? client.adId ?? undefined,
      adName: explicit.adName ?? client.adName ?? undefined,
      adsetId: explicit.adsetId ?? client.adsetId ?? undefined,
      adsetName: explicit.adsetName ?? client.adsetName ?? undefined,
      campaignId: explicit.campaignId ?? client.campaignId ?? undefined,
      campaignName: explicit.campaignName ?? client.campaignName ?? undefined,
      placement: explicit.placement ?? client.placement ?? undefined,
      siteSourceName: explicit.siteSourceName ?? client.siteSourceName ?? undefined,
      fbclid: explicit.fbclid ?? client.fbclid ?? undefined,
      ttclid: explicit.ttclid ?? client.ttclid ?? undefined,
    };
  }
}
