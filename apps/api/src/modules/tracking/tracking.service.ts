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
  // Запрос пользователя 2026-07-27 (уточнение того же дня): Project.disabledTrackingEvents
  // гасит только АВТОМАТИЧЕСКОЕ срабатывание Subscribe/Dialogue/Purchase — ручные действия
  // сотрудника (кнопка "Зарегистрировать диалог", форма "Добавить покупку" в списке клиентов)
  // должны продолжать уходить в Facebook/TikTok, даже если свитч выключен. Проставляется ТОЛЬКО
  // вызывающими, которые точно знают, что это ручное действие (см. ClientsService.
  // applyDialogueUpdate/PurchasesService.create) — по умолчанию false, все остальные (в т.ч.
  // автоматические Subscribe/Dialogue) подчиняются свитчу как обычно.
  forceSend?: boolean;
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
            // fbp/countryCode (запрос пользователя 2026-07-29) — для FacebookCAPIService's
            // user_data.fbp/country. tgUserId — для user_data.subscription_id (тот же запрос,
            // сверка с реальным примером конкурента: у них subscription_id — реальный численный
            // ID подписки, для Telegram-канала естественный эквивалент — сам Telegram user id).
            fbp: attribution.fbp,
            countryCode: attribution.countryCode,
            tgUserId: dto.tgUserId,
            // fbclidCapturedAt (запрос пользователя 2026-07-28, сверка с ответом конкурента) —
            // честный момент первого наблюдения fbclid, для fbc-таймстампа в
            // FacebookCAPIService (см. комментарий там же), не момент отправки события.
            fbclidCapturedAt: attribution.fbclidCapturedAt?.toISOString(),
            email: dto.email,
            phone: dto.phone,
            // ipAddress/userAgent — теперь из resolveAttribution (дотягиваются из Client для
            // отложенных Telegram-событий, не только из dto), см. комментарий в
            // resolveAttribution выше.
            ipAddress: attribution.ipAddress,
            userAgent: attribution.userAgent,
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
          buyerId: attribution.buyerId,
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

    // Запрос пользователя 2026-07-27: свитчи включения/выключения пересылки по типу события
    // (Project.disabledTrackingEvents) — та же граница, что и hasAdAttribution выше: сама
    // запись в TrackingEvent уже сделана, выключается только пересылка на рекламные платформы.
    // dto.forceSend (уточнение того же дня) — свитч гасит только автоматическое срабатывание,
    // ручные действия сотрудника (dto.forceSend: true) его обходят.
    const isEventTypeDisabled = !dto.forceSend && (await this.isTrackingEventDisabled(projectId, dto.eventName));

    if (hasAdAttribution && !isEventTypeDisabled) {
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

  private async isTrackingEventDisabled(projectId: string, eventName: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { disabledTrackingEvents: true },
    });
    return !!project?.disabledTrackingEvents.includes(eventName);
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
  //
  // Правки 2026-07-28 (сверка с реальным запросом конкурента, у которого события реально
  // доходят до Facebook): (1) ipAddress/userAgent теперь тоже подтягиваются из Client, не
  // только из dto — у отложенных Subscribe/Dialogue (пришли через Telegram, не браузер)
  // dto.ipAddress/dto.userAgent всегда пусты, хотя у Client они обычно уже есть с момента
  // первого визита на лендинг (ClientsService.findOrCreate/getGeoByIp) — то же самое
  // "дотягивание" уже применялось к pixelId/adId и т.п., просто не было распространено на эти
  // два поля; (2) fbclidCapturedAt — момент, когда fbclid РЕАЛЬНО был впервые увиден (для
  // честного fbc-таймстампа в FacebookCAPIService, см. баг там же), а не момент отправки
  // события, который может отличаться на часы для отложенных конверсий.
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
      ipAddress: dto.ipAddress,
      userAgent: dto.userAgent,
      // fbp/countryCode (запрос пользователя 2026-07-29, сверка с реальным примером конкурента) —
      // тот же принцип, что и у ipAddress/userAgent выше: у отложенных Telegram-событий берём из
      // Client, если сейчас явно не пришли. dto.countryCode не существует (браузер сам не знает
      // свой ISO-код) — только через Client, поэтому explicit.countryCode всегда undefined тут.
      fbp: dto.fbp,
      countryCode: undefined as string | undefined,
      // Атрибуция баера на уровне события (запрос пользователя 2026-08-03) — dto.buyerRef уже
      // реально долетает сюда от SDK (та же сессионная механика, что pixelId/campaignId, см.
      // link-params.const.ts), просто раньше нигде не читался: поле было добавлено в DTO
      // 2026-07-21 только чтобы ValidationPipe не отклонял запрос, реальная атрибуция Client.
      // buyerId шла отдельным Redis-мостом (LandingRendererService). Теперь это первый настоящий
      // потребитель значения — просмотры/клики лендинга (PageView/Lead), которые происходят ДО
      // создания Client, наконец тоже получают атрибуцию баера.
      buyerId: dto.buyerRef,
    };
    const fbclidCapturedAt: Date | undefined = dto.fbclid ? new Date() : undefined;

    if (!clientId || Object.values(explicit).every((v) => v !== undefined)) {
      return { ...explicit, fbclidCapturedAt };
    }

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
        ipAddress: true,
        userAgent: true,
        fbp: true,
        countryCode: true,
        firstSeenAt: true,
        buyerId: true,
      },
    });
    if (!client) return { ...explicit, fbclidCapturedAt };

    return {
      pixelId: explicit.pixelId ?? client.pixelId ?? undefined,
      buyerId: explicit.buyerId ?? client.buyerId ?? undefined,
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
      ipAddress: explicit.ipAddress ?? client.ipAddress ?? undefined,
      userAgent: explicit.userAgent ?? client.userAgent ?? undefined,
      fbp: explicit.fbp ?? client.fbp ?? undefined,
      countryCode: client.countryCode ?? undefined,
      // Если fbclid не пришёл прямо сейчас, а подтянут из Client — значит его реально впервые
      // увидели при первом визите этого клиента, не сейчас.
      fbclidCapturedAt: fbclidCapturedAt ?? ((explicit.fbclid ?? client.fbclid) ? client.firstSeenAt : undefined),
    };
  }
}
