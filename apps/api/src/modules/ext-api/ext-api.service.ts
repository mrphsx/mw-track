import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Channel, Client, Prisma, Project } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { resolveBuyerShortCode, resolvePixelShortCode } from '../../common/short-code.util';
import { ClientsService } from '../clients/clients.service';
import { PurchasesService } from '../clients/purchases.service';
import { TrackingService } from '../tracking/tracking.service';
import { FunnelConfigService } from '../funnel/funnel-config.service';
import { ChatStoreService } from '../chat/chat-store.service';
import { BOT_LINK_UTM_SOURCE, parseBotLinkStart } from '../channels/bot-link.util';
import { ExtEventDto } from './ext-event.dto';

type ProjectWithChannel = Project & { channel: Channel | null };

interface Attribution {
  fbclid?: string;
  ttclid?: string;
  fbp?: string;
  ipAddress?: string;
  userAgent?: string;
  countryCode?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  pixelId?: string;
  adId?: string;
  adName?: string;
  adsetId?: string;
  adsetName?: string;
  campaignId?: string;
  campaignName?: string;
  placement?: string;
  siteSourceName?: string;
  buyerId?: string;
  landingId?: string;
  abTestGroupId?: string;
  botLinkId?: string;
}

export interface ExtEventResult {
  ok: boolean;
  type: string;
  event_id?: string;
  client_id?: string;
  attributed?: boolean;
  duplicate?: boolean;
  error?: string;
}

const LOG_PAYLOAD_LIMIT = 4000;

// Единый API событий (2026-11-05: «боты на других платформах — данные будет кидать второй сервис
// по нашему API, абсолютно все события»; API единый для любого типа проекта). Каждое событие идёт
// той же дорогой, что у подключённого бота: клиент и атрибуция — ClientsService, лид — Subscribe,
// первое сообщение — Dialogue, покупка — PurchasesService (ФД/РД), события в FB/TikTok — через
// TrackingService с переключателями событий проекта. Авторизация — секретный ключ проекта.
@Injectable()
export class ExtApiService {
  private readonly logger = new Logger(ExtApiService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private clients: ClientsService,
    private purchases: PurchasesService,
    private tracking: TrackingService,
    private funnel: FunnelConfigService,
    private chatStore: ChatStoreService,
  ) {}

  async projectByKey(header: string | undefined): Promise<ProjectWithChannel> {
    const key = (header ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!key.startsWith('sk_')) throw new UnauthorizedException('Нужен секретный ключ проекта: заголовок X-Api-Key или Authorization: Bearer <ключ>');
    const project = await this.prisma.project.findFirst({
      where: { secretKey: key, deletedAt: null },
      include: { channel: true, company: { select: { isSuspended: true } } },
    });
    if (!project) throw new UnauthorizedException('Неверный ключ API');
    if ((project as unknown as { company: { isSuspended: boolean } }).company.isSuspended) throw new UnauthorizedException('Компания заблокирована');
    return project;
  }

  async processBatch(project: ProjectWithChannel, events: ExtEventDto[]): Promise<ExtEventResult[]> {
    const results: ExtEventResult[] = [];
    for (const ev of events) results.push(await this.processOne(project, ev));
    return results;
  }

  async processOne(project: ProjectWithChannel, ev: ExtEventDto): Promise<ExtEventResult> {
    const base: ExtEventResult = { ok: true, type: ev.type, event_id: ev.event_id };
    if (ev.event_id) {
      const prev = await this.prisma.externalApiLog.findUnique({ where: { projectId_eventId: { projectId: project.id, eventId: ev.event_id } } });
      if (prev) return { ...base, ok: prev.ok, duplicate: true, client_id: prev.clientId ?? undefined, error: prev.error ?? undefined };
    }
    let result: ExtEventResult;
    try {
      result = { ...base, ...(await this.handle(project, ev)) };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Ошибка обработки';
      result = { ...base, ok: false, error: msg };
    }
    try {
      const payload = JSON.stringify(ev);
      await this.prisma.externalApiLog.create({
        data: {
          projectId: project.id,
          eventId: ev.event_id ?? null,
          type: ev.type,
          ok: result.ok,
          error: result.error?.slice(0, 500) ?? null,
          clientId: result.client_id ?? null,
          payload: (payload.length > LOG_PAYLOAD_LIMIT ? { truncated: payload.slice(0, LOG_PAYLOAD_LIMIT) } : JSON.parse(payload)) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      // Гонка двух одинаковых event_id — второй увидит дубль; журнал не должен ломать ответ.
      this.logger.warn(`ext-api log: ${(error as Error).message}`);
    }
    return result;
  }

  private async handle(project: ProjectWithChannel, ev: ExtEventDto): Promise<Partial<ExtEventResult>> {
    const hasIdentity = ev.tg_user_id || ev.external_id || ev.phone || ev.email;
    if (!hasIdentity) throw new BadRequestException('Укажите, кто это: tg_user_id, external_id, phone или email');
    if (ev.tg_user_id && !/^\d{1,20}$/.test(ev.tg_user_id)) throw new BadRequestException('tg_user_id — число (Telegram ID)');

    switch (ev.type) {
      case 'start':
        return this.onStart(project, ev);
      case 'lead':
      case 'subscribe':
        return this.onLead(project, ev);
      case 'unsubscribe':
        return this.onUnsubscribe(project, ev);
      case 'message_in':
        return this.onMessageIn(project, ev);
      case 'message_out':
        return this.onMessageOut(project, ev);
      case 'bot_blocked':
      case 'bot_unblocked':
        return this.onBotStatus(project, ev);
      case 'contact':
        return this.onContact(project, ev);
      case 'purchase':
        return this.onPurchase(project, ev);
      default:
        throw new BadRequestException('Неизвестный тип события');
    }
  }

  // ---- атрибуция ----

  private async attributionFor(project: ProjectWithChannel, ev: ExtEventDto): Promise<{ attribution: Attribution | null; codeKey?: string }> {
    if (ev.start_code) {
      const code = ev.start_code.trim().replace(/^\/start\s+/i, '');
      const raw = /^[A-Za-z0-9_-]{4,64}$/.test(code) ? await this.redis.get(`start:${code}`) : null;
      if (raw) {
        const a = JSON.parse(raw) as Record<string, string | undefined>;
        return {
          codeKey: `start:${code}`,
          attribution: {
            fbclid: a.fbclid,
            ttclid: a.ttclid,
            fbp: a.fbp,
            ipAddress: a.ip,
            userAgent: a.userAgent,
            countryCode: a.countryCode,
            utmSource: a.utmSource,
            utmCampaign: a.utmCampaign,
            pixelId: a.pixelId,
            adId: a.adId,
            adName: a.adName,
            adsetId: a.adsetId,
            adsetName: a.adsetName,
            campaignId: a.campaignId,
            campaignName: a.campaignName,
            placement: a.placement,
            siteSourceName: a.siteSourceName,
            buyerId: a.buyerRef,
            landingId: a.landingId,
            abTestGroupId: a.abTestGroupId ?? undefined,
          },
        };
      }
      // Ссылка на бота из «Ссылок на бота» (код b_…).
      const parsed = parseBotLinkStart(code);
      if (parsed) {
        const link = await this.prisma.botLink.findFirst({ where: { code: parsed.code, projectId: project.id, deletedAt: null } });
        if (link) {
          return {
            attribution: {
              utmSource: BOT_LINK_UTM_SOURCE[link.source],
              utmCampaign: link.name,
              pixelId: link.pixelId ?? undefined,
              adId: parsed.adId,
              campaignId: parsed.campaignId,
              buyerId: link.buyerId ?? undefined,
              botLinkId: link.id,
            },
          };
        }
      }
    }
    const a = ev.attribution;
    if (!a) return { attribution: null };
    return {
      attribution: {
        fbclid: a.fbclid,
        ttclid: a.ttclid,
        fbp: a.fbp,
        ipAddress: a.ip,
        userAgent: a.user_agent,
        countryCode: a.country_code?.toUpperCase(),
        utmSource: a.utm_source,
        utmMedium: a.utm_medium,
        utmCampaign: a.utm_campaign,
        utmContent: a.utm_content,
        utmTerm: a.utm_term,
        pixelId: (await resolvePixelShortCode(this.prisma, a.pixel)) ?? undefined,
        adId: a.ad_id,
        adName: a.ad_name,
        adsetId: a.adset_id,
        adsetName: a.adset_name,
        campaignId: a.campaign_id,
        campaignName: a.campaign_name,
        placement: a.placement,
        siteSourceName: a.site_source_name,
        buyerId: (await resolveBuyerShortCode(this.prisma, a.buyer)) ?? undefined,
      },
    };
  }

  // ---- клиент ----

  private normPhone(phone?: string) {
    const digits = phone?.replace(/[^\d+]/g, '');
    return digits && digits.replace(/\D/g, '').length >= 6 ? digits : undefined;
  }

  private async findClient(project: ProjectWithChannel, ev: ExtEventDto): Promise<Client | null> {
    const base = { projectId: project.id, deletedAt: null };
    if (ev.tg_user_id) return this.prisma.client.findFirst({ where: { ...base, tgUserId: ev.tg_user_id } });
    if (ev.external_id) return this.prisma.client.findFirst({ where: { ...base, externalId: ev.external_id } });
    const phone = this.normPhone(ev.phone);
    if (phone) {
      const byPhone = await this.prisma.client.findFirst({ where: { ...base, phone } });
      if (byPhone) return byPhone;
    }
    if (ev.email) return this.prisma.client.findFirst({ where: { ...base, email: ev.email.trim().toLowerCase() } });
    return null;
  }

  private async getOrCreateClient(project: ProjectWithChannel, ev: ExtEventDto, markSubscribed: boolean, attribution: Attribution | null): Promise<Client> {
    const existing = await this.findClient(project, ev);
    if (existing) {
      await this.updateProfile(existing, ev);
      return existing;
    }
    const a = attribution ?? {};
    return this.clients.findOrCreate({
      projectId: project.id,
      channelType: ev.tg_user_id ? 'TELEGRAM' : project.channel?.type ?? 'TELEGRAM',
      tgUserId: ev.tg_user_id,
      tgUsername: ev.username?.replace(/^@/, ''),
      tgFirstName: ev.first_name,
      tgLastName: ev.last_name,
      tgLanguage: ev.language,
      externalId: ev.external_id,
      phone: this.normPhone(ev.phone),
      email: ev.email?.trim().toLowerCase(),
      markSubscribed,
      ...a,
    });
  }

  private async updateProfile(client: Client, ev: ExtEventDto) {
    const data: Prisma.ClientUpdateInput = {};
    if (ev.username && ev.username.replace(/^@/, '') !== client.tgUsername) data.tgUsername = ev.username.replace(/^@/, '');
    if (ev.first_name && ev.first_name !== client.tgFirstName) data.tgFirstName = ev.first_name;
    if (ev.last_name && ev.last_name !== client.tgLastName) data.tgLastName = ev.last_name;
    if (ev.external_id && !client.externalId) data.externalId = ev.external_id;
    const phone = this.normPhone(ev.phone);
    if (phone && phone !== client.phone) data.phone = phone;
    if (ev.email && ev.email.trim().toLowerCase() !== client.email) data.email = ev.email.trim().toLowerCase();
    if (Object.keys(data).length) await this.prisma.client.update({ where: { id: client.id }, data });
  }

  // Атрибуция у уже существующего клиента — той же функцией, что и у бота (первая побеждает).
  private async applyAttribution(project: ProjectWithChannel, client: Client, attribution: Attribution | null) {
    if (!attribution) return;
    if (client.tgUserId) {
      await this.clients.updateTracking(client.tgUserId, project.id, attribution);
    }
    const extra: Prisma.ClientUpdateInput = {};
    if (attribution.landingId && !client.landingId) extra.landing = { connect: { id: attribution.landingId } };
    if (attribution.botLinkId && !client.botLinkId) extra.botLink = { connect: { id: attribution.botLinkId } };
    if (Object.keys(extra).length) await this.prisma.client.update({ where: { id: client.id }, data: extra }).catch(() => undefined);
  }

  // Лид: впервые отмечается подписчиком воронки — Subscribe в статистику и рекламные кабинеты.
  // wasLead — был ли лидом ДО этого события: новый клиент создаётся уже подписанным, поэтому
  // смотреть на subscribedAt после создания нельзя — Subscribe тогда никогда бы не ушёл.
  private async markLead(project: ProjectWithChannel, client: Client, attribution: Attribution | null, wasLead: boolean) {
    if (wasLead) return false;
    const fresh = await this.prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    if (!fresh.subscribedAt || !fresh.isSubscribed) {
      await this.prisma.client.update({
        where: { id: client.id },
        data: { subscribedAt: fresh.subscribedAt ?? new Date(), isSubscribed: true, unsubscribedAt: null },
      });
    }
    await this.tracking.recordEvent(project.id, {
      eventName: 'Subscribe',
      clientId: client.id,
      tgUserId: client.tgUserId ?? undefined,
      buyerRef: attribution?.buyerId ?? fresh.buyerId ?? undefined,
      landingId: fresh.landingId ?? attribution?.landingId,
      abTestGroupId: fresh.abTestGroupId ?? undefined,
      // Телефон/email из API — для сопоставления в FB (em/ph) и TikTok (хэшируются при отправке),
      // так же, как PurchasesService уже делает для Purchase.
      email: fresh.email ?? undefined,
      phone: fresh.phone ?? undefined,
      source: 'SERVER',
    });
    return true;
  }

  private async telegramConversationChannel(project: ProjectWithChannel, ev: ExtEventDto): Promise<Channel | null> {
    return project.channel?.type === 'TELEGRAM' && ev.tg_user_id ? project.channel : null;
  }

  // ---- события ----

  // Лид нажал «Старт» у бота. Лидом считается, если пришёл по нашему коду (лендинг или ссылка на
  // бота) или если в «Воронке» проекта лидом считается любой старт бота.
  private async onStart(project: ProjectWithChannel, ev: ExtEventDto) {
    if (!ev.tg_user_id) throw new BadRequestException('Для start нужен tg_user_id');
    const { attribution, codeKey } = await this.attributionFor(project, ev);
    const funnel = project.channel ? await this.funnel.forChannel(project.channel) : null;
    const isLead = !!attribution || funnel?.leadBotStart === 'ALL';
    const before = await this.findClient(project, ev);
    if (before && attribution) await this.applyAttribution(project, before, attribution);

    await this.clients.recordInboundMessage(project.id, {
      tgUserId: ev.tg_user_id,
      tgUsername: ev.username?.replace(/^@/, ''),
      tgFirstName: ev.first_name,
      tgLastName: ev.last_name,
      treatAsSubscriber: isLead,
      viaBot: true,
      countBotAsDialogue: funnel?.dialogueBotMessage ?? false,
      ...(attribution ?? {}),
    });
    const client = await this.findClient(project, ev);
    if (!client) throw new BadRequestException('Клиент не создан — возможно, достигнут лимит клиентов тарифа');
    await this.updateProfile(client, ev);
    if (!before && attribution) await this.applyAttribution(project, client, attribution);
    let lead = false;
    if (isLead) lead = await this.markLead(project, client, attribution, !!before?.subscribedAt);
    if (codeKey) await this.redis.del(codeKey);

    const channel = await this.telegramConversationChannel(project, ev);
    if (channel) {
      await this.chatStore.recordIncoming(channel, 'BOT', {
        peerId: ev.tg_user_id,
        firstName: ev.first_name,
        lastName: ev.last_name,
        username: ev.username?.replace(/^@/, ''),
        text: '/start',
        media: null,
        externalId: `ext-start-${Date.now()}`,
        sentAt: new Date(),
      });
      await this.chatStore.linkClient(channel, ev.tg_user_id);
    }
    return { client_id: client.id, attributed: !!attribution, lead };
  }

  private async onLead(project: ProjectWithChannel, ev: ExtEventDto) {
    const { attribution, codeKey } = await this.attributionFor(project, ev);
    const before = await this.findClient(project, ev);
    const client = await this.getOrCreateClient(project, ev, true, attribution);
    await this.applyAttribution(project, client, attribution);
    const lead = await this.markLead(project, client, attribution, !!before?.subscribedAt);
    if (codeKey) await this.redis.del(codeKey);
    return { client_id: client.id, attributed: !!attribution, lead };
  }

  private async onUnsubscribe(project: ProjectWithChannel, ev: ExtEventDto) {
    const client = await this.findClient(project, ev);
    if (!client) throw new BadRequestException('Лид не найден');
    if (client.tgUserId) {
      await this.clients.markUnsubscribed(client.tgUserId, project.id);
    } else if (client.subscribedAt && client.isSubscribed) {
      await this.prisma.client.update({ where: { id: client.id }, data: { isSubscribed: false, unsubscribedAt: new Date() } });
      await this.tracking.recordEvent(project.id, { eventName: 'Unsubscribe', clientId: client.id, source: 'SERVER' });
    }
    return { client_id: client.id };
  }

  // Сообщение лида: первое — «Диалог» (статистика и рекламные кабинеты), всё — в чат CRM.
  private async onMessageIn(project: ProjectWithChannel, ev: ExtEventDto) {
    const { attribution } = await this.attributionFor(project, ev);
    let client: Client | null;
    if (ev.tg_user_id) {
      await this.clients.recordInboundMessage(project.id, {
        tgUserId: ev.tg_user_id,
        tgUsername: ev.username?.replace(/^@/, ''),
        tgFirstName: ev.first_name,
        tgLastName: ev.last_name,
        treatAsSubscriber: false,
        viaBot: true,
        countBotAsDialogue: true,
        ...(attribution ?? {}),
      });
      client = await this.findClient(project, ev);
    } else {
      client = await this.getOrCreateClient(project, ev, false, attribution);
      await this.clients.recordApiDialogue(project.id, client);
    }
    if (!client) throw new BadRequestException('Клиент не создан — возможно, достигнут лимит клиентов тарифа');
    await this.updateProfile(client, ev);

    const channel = await this.telegramConversationChannel(project, ev);
    if (channel && ev.text) {
      await this.chatStore.recordIncoming(channel, 'BOT', {
        peerId: ev.tg_user_id!,
        firstName: ev.first_name,
        lastName: ev.last_name,
        username: ev.username?.replace(/^@/, ''),
        text: ev.text,
        media: null,
        externalId: `ext-in-${ev.event_id ?? Date.now()}`,
        sentAt: ev.occurred_at && !isNaN(Date.parse(ev.occurred_at)) ? new Date(ev.occurred_at) : new Date(),
      });
      await this.chatStore.linkClient(channel, ev.tg_user_id!);
    }
    return { client_id: client.id };
  }

  // Ответ бота (внешнего сервиса) — только в переписку CRM.
  private async onMessageOut(project: ProjectWithChannel, ev: ExtEventDto) {
    if (!ev.text) throw new BadRequestException('Для message_out нужен text');
    const channel = await this.telegramConversationChannel(project, ev);
    const client = await this.findClient(project, ev);
    if (!channel) return { client_id: client?.id };
    const conversation = await this.prisma.conversation.findUnique({
      where: { channelId_source_botKey_peerId: { channelId: channel.id, source: 'BOT', botKey: '', peerId: ev.tg_user_id! } },
      select: { id: true },
    });
    if (!conversation) return { client_id: client?.id };
    await this.chatStore.appendOutgoing(conversation.id, { senderType: 'BOT', text: ev.text });
    return { client_id: client?.id };
  }

  private async onBotStatus(project: ProjectWithChannel, ev: ExtEventDto) {
    const client = await this.findClient(project, ev);
    if (!client?.tgUserId) throw new BadRequestException('Лид с таким tg_user_id не найден');
    if (ev.type === 'bot_blocked') await this.clients.markBotBlocked(client.tgUserId, project.id);
    else await this.clients.markBotUnblocked(client.tgUserId, project.id);
    return { client_id: client.id };
  }

  private async onContact(project: ProjectWithChannel, ev: ExtEventDto) {
    const { attribution } = await this.attributionFor(project, ev);
    const client = await this.getOrCreateClient(project, ev, false, attribution);
    await this.applyAttribution(project, client, attribution);
    return { client_id: client.id };
  }

  // Покупка: ФД или РД определяется по истории клиента, событие Purchase — в рекламные кабинеты.
  private async onPurchase(project: ProjectWithChannel, ev: ExtEventDto) {
    if (!ev.amount) throw new BadRequestException('Для purchase нужна сумма amount');
    const { attribution } = await this.attributionFor(project, ev);
    const before = await this.findClient(project, ev);
    const client = await this.getOrCreateClient(project, ev, true, attribution);
    await this.applyAttribution(project, client, attribution);
    // Лид, впервые появившийся сразу с покупкой, — это ещё и новый лид воронки.
    if (!before) await this.markLead(project, client, attribution, false);
    const key = ev.purchase_id ?? ev.event_id;
    const purchase = await this.purchases.create(project.id, client.id, {
      amount: ev.amount,
      currency: ev.currency?.toUpperCase(),
      orderId: ev.purchase_id,
      idempotencyKey: key ? `ext:${project.id}:${key}` : undefined,
      source: 'api',
    });
    return { client_id: client.id, purchase_id: purchase.id } as Partial<ExtEventResult>;
  }

  // Журнал для страницы «API» в настройках проекта.
  async logs(projectId: string, take = 100) {
    return this.prisma.externalApiLog.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take });
  }
}
