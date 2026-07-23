import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChannelType, Client, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { ClientFiltersDto } from './dto/client-filters.dto';
import { PushFilterDto } from './dto/push-filter.dto';
import { ClientsRepository } from './clients.repository';

export class ClientLimitReachedException extends Error {
  constructor() {
    super('Достигнут лимит клиентов для этого тарифного плана');
  }
}

export interface FindOrCreateClientInput {
  projectId: string;
  // Каким лендингом привлечён — см. Client.landingId в schema.prisma. Первое известное
  // значение побеждает (см. ветку "existing" ниже), как и для fbclid/ttclid.
  landingId?: string;
  channelType: ChannelType;
  tgUserId?: string;
  tgUsername?: string;
  tgFirstName?: string;
  tgLastName?: string;
  tgLanguage?: string;
  tgIsPremium?: boolean;
  tgPhotoUrl?: string;
  waPhone?: string;
  waName?: string;
  igUserId?: string;
  igUsername?: string;
  email?: string;
  phone?: string;
  ipAddress?: string;
  userAgent?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  fbclid?: string;
  ttclid?: string;
  subscribedAt?: Date;
  // Вступил в приватный канал не через нашу заявку (запрос пользователя 2026-07-21) — см.
  // Client.externalSubscribedAt в schema.prisma. Используется вместе с markSubscribed: false —
  // человек остаётся "внешним контактом" (subscribedAt не ставится), но с реальной датой
  // вступления вместо пустой.
  externalSubscribedAt?: Date;
  // Приблизительная страна из кэша визита на лендинг (см. LandingRendererService/
  // TelegramProvider.getCachedLandingCountry) — приоритетнее geo-по-IP ниже, если передана явно.
  country?: string;
  // Пиксель + рекламные макросы (запрос пользователя 2026-07-04, трекинг-ссылки лендинга) —
  // персистится тем же путём, что и fbclid/utm выше (start:<code> Redis-блок → updateTracking).
  pixelId?: string;
  adId?: string;
  adName?: string;
  adsetId?: string;
  adsetName?: string;
  campaignId?: string;
  campaignName?: string;
  placement?: string;
  siteSourceName?: string;
  // Метка баера (Фаза 3.6, Team Analytics) — тот же путь, что и pixelId/adId выше
  // (start:<code> Redis-блок → сюда), либо landing-visit-buyer:<landingId> для
  // PRIVATE_CHANNEL_REQUEST (см. TelegramProvider.handleJoinRequest).
  buyerId?: string;
  // Ложится в isSubscribed/subscribedAt только когда true (по умолчанию, если не передано —
  // для обратной совместимости со всеми явными "это реальное событие подписки" вызовами:
  // handleJoinRequest/handleChatMemberUpdate/WhatsApp/Instagram). false — используется
  // ТОЛЬКО для холодных контактов, см. recordInboundMessage ниже и баг-репорт пользователя
  // 2026-07-17 ("написал клиент который перешёл не по нашей ссылке... систем его сразу
  // добавила в список клиентов и диалоги нашей системы").
  markSubscribed?: boolean;
}

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    private prisma: PrismaService,
    private repository: ClientsRepository,
    private trackingService: TrackingService,
  ) {}

  async findOrCreate(data: FindOrCreateClientInput): Promise<Client> {
    const where = this.buildIdentityWhere(data.projectId, data);
    const existing = await this.prisma.client.findFirst({ where });

    if (existing) {
      // markSubscribed: false (запрос пользователя 2026-07-21, вступление в канал не через
      // нашу заявку) — раньше эта ветка безусловно ставила isSubscribed:true/subscribedAt
      // даже для холодных внешних контактов, потому что единственный вызывающий с
      // markSubscribed:false (recordInboundMessage) никогда не попадал сюда (сначала проверяет
      // findByTgId). Теперь появился второй вызывающий с markSubscribed:false, который МОЖЕТ
      // найти existing — не должен превращать внешний контакт в настоящую подписку воронки.
      const shouldMarkSubscribed = data.markSubscribed !== false;
      return this.prisma.client.update({
        where: { id: existing.id },
        data: {
          isSubscribed: shouldMarkSubscribed ? true : existing.isSubscribed,
          isBotActive: true,
          lastActiveAt: new Date(),
          subscribedAt: shouldMarkSubscribed ? (existing.subscribedAt ?? data.subscribedAt ?? new Date()) : existing.subscribedAt,
          tgUsername: data.tgUsername ?? existing.tgUsername,
          tgFirstName: data.tgFirstName ?? existing.tgFirstName,
          tgLastName: data.tgLastName ?? existing.tgLastName,
          tgLanguage: data.tgLanguage ?? existing.tgLanguage,
          tgIsPremium: data.tgIsPremium ?? existing.tgIsPremium,
          tgPhotoUrl: data.tgPhotoUrl ?? existing.tgPhotoUrl,
          country: existing.country ?? data.country,
          utmSource: existing.utmSource ?? data.utmSource,
          fbclid: existing.fbclid ?? data.fbclid,
          ttclid: existing.ttclid ?? data.ttclid,
          landingId: existing.landingId ?? data.landingId,
          pixelId: existing.pixelId ?? data.pixelId,
          adId: existing.adId ?? data.adId,
          adName: existing.adName ?? data.adName,
          adsetId: existing.adsetId ?? data.adsetId,
          adsetName: existing.adsetName ?? data.adsetName,
          campaignId: existing.campaignId ?? data.campaignId,
          campaignName: existing.campaignName ?? data.campaignName,
          placement: existing.placement ?? data.placement,
          siteSourceName: existing.siteSourceName ?? data.siteSourceName,
          buyerId: existing.buyerId ?? data.buyerId,
          externalSubscribedAt: existing.externalSubscribedAt ?? data.externalSubscribedAt,
        },
      });
    }

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: data.projectId },
      select: { companyId: true },
    });
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: project.companyId } });

    if (company.currentClients >= company.maxClients) {
      throw new ClientLimitReachedException();
    }

    const geo = data.ipAddress ? await this.getGeoByIp(data.ipAddress) : {};

    const client = await this.prisma.client.create({
      data: {
        companyId: project.companyId,
        projectId: data.projectId,
        landingId: data.landingId,
        channelType: data.channelType,
        tgUserId: data.tgUserId,
        tgUsername: data.tgUsername,
        tgFirstName: data.tgFirstName,
        tgLastName: data.tgLastName,
        tgLanguage: data.tgLanguage,
        tgIsPremium: data.tgIsPremium,
        tgPhotoUrl: data.tgPhotoUrl,
        waPhone: data.waPhone,
        waName: data.waName,
        igUserId: data.igUserId,
        igUsername: data.igUsername,
        email: data.email,
        phone: data.phone,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        utmSource: data.utmSource,
        utmMedium: data.utmMedium,
        utmCampaign: data.utmCampaign,
        utmContent: data.utmContent,
        utmTerm: data.utmTerm,
        fbclid: data.fbclid,
        ttclid: data.ttclid,
        pixelId: data.pixelId,
        adId: data.adId,
        adName: data.adName,
        adsetId: data.adsetId,
        adsetName: data.adsetName,
        campaignId: data.campaignId,
        campaignName: data.campaignName,
        placement: data.placement,
        siteSourceName: data.siteSourceName,
        buyerId: data.buyerId,
        country: data.country ?? geo.country,
        city: geo.city,
        externalSubscribedAt: data.externalSubscribedAt,
        // markSubscribed:false — холодный контакт (написал не через наш лендинг/канал/
        // трекинг-ссылку): Client всё равно нужен, чтобы вести с ним диалог в CRM, но он не
        // должен считаться нашим подписчиком/влиять на статистику воронки, пока не появится
        // реальная атрибуция (join-request по нашей ссылке и т.п.).
        isSubscribed: data.markSubscribed !== false,
        subscribedAt: data.markSubscribed !== false ? (data.subscribedAt ?? new Date()) : null,
        lastActiveAt: new Date(),
      },
    });

    await this.prisma.company.update({
      where: { id: project.companyId },
      data: { currentClients: { increment: 1 } },
    });

    return client;
  }

  async updateTracking(
    tgUserId: string,
    projectId: string,
    data: {
      fbclid?: string;
      ttclid?: string;
      utmSource?: string;
      utmCampaign?: string;
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
    },
  ) {
    const client = await this.prisma.client.findFirst({ where: { projectId, tgUserId } });
    if (!client) return null;

    return this.prisma.client.update({
      where: { id: client.id },
      data: {
        fbclid: data.fbclid ?? client.fbclid,
        ttclid: data.ttclid ?? client.ttclid,
        utmSource: data.utmSource ?? client.utmSource,
        utmCampaign: data.utmCampaign ?? client.utmCampaign,
        pixelId: data.pixelId ?? client.pixelId,
        adId: data.adId ?? client.adId,
        adName: data.adName ?? client.adName,
        adsetId: data.adsetId ?? client.adsetId,
        adsetName: data.adsetName ?? client.adsetName,
        campaignId: data.campaignId ?? client.campaignId,
        campaignName: data.campaignName ?? client.campaignName,
        placement: data.placement ?? client.placement,
        siteSourceName: data.siteSourceName ?? client.siteSourceName,
        buyerId: data.buyerId ?? client.buyerId,
      },
    });
  }

  // updateMany вместо findFirst+update — это вызывается из catch-блока отправки
  // сообщения (best-effort), не должно бросать, если клиент почему-то не нашёлся
  async markBotBlocked(tgUserId: string, projectId: string) {
    return this.prisma.client.updateMany({
      where: { projectId, tgUserId },
      data: { isBotActive: false },
    });
  }

  // Прямой сигнал разблокировки от Telegram (my_chat_member, chat.type==='private',
  // new_chat_member.status==='member') — см. TelegramProvider.handleMemberUpdate. Не трогает
  // botActivatedAt/firstDialogueAt — это не сообщение, просто смена статуса участника, а не
  // диалог.
  async markBotUnblocked(tgUserId: string, projectId: string) {
    return this.prisma.client.updateMany({
      where: { projectId, tgUserId },
      data: { isBotActive: true },
    });
  }

  // Баг найден 2026-07-21 (запрос пользователя: "для внешних контактов у всех написано что
  // отписались, хотя они не отписались") — вызывается из TelegramProvider.handleMemberUpdate
  // на любое "покинул канал" chat_member-событие, БЕЗ проверки tgMode (в отличие от ветки
  // подписки чуть выше по коду, которая явно пропускает PRIVATE_CHANNEL_REQUEST). Внешние
  // холодные контакты (subscribedAt: null, просто написали в личку/боту) могут состоять в
  // канале другим путём (не через нашу заявку) — их уход из канала раньше безусловно ставил
  // unsubscribedAt, хотя подписки через нашу воронку у них никогда не было. Теперь трогаем
  // только тех, у кого subscribedAt реально был задан.
  async markUnsubscribed(tgUserId: string, projectId: string) {
    return this.prisma.client.updateMany({
      where: { projectId, tgUserId, subscribedAt: { not: null } },
      data: { isSubscribed: false, unsubscribedAt: new Date() },
    });
  }

  // Только для GET /clients/:id/avatar (ClientsController) — не через ChannelsService
  // (см. комментарий там, ClientsModule/ChannelsModule не связаны напрямую после
  // circular-DI инцидента), простой прямой prisma-запрос вместо этого.
  async getChannelBotToken(projectId: string): Promise<{ id: string; tgBotToken: string | null } | null> {
    return this.prisma.channel.findFirst({ where: { projectId }, select: { id: true, tgBotToken: true } });
  }

  async findByUsername(username: string, projectId: string): Promise<Client | null> {
    return this.prisma.client.findFirst({ where: { projectId, tgUsername: username, deletedAt: null } });
  }

  async findByTgId(tgUserId: string, projectId: string): Promise<Client | null> {
    return this.prisma.client.findFirst({ where: { projectId, tgUserId, deletedAt: null } });
  }

  // Единая точка учёта диалога (запрос пользователя 2026-07-04) — вызывается и из
  // TelegramProvider.handleIncomingText (бот-каналы: Client там уже существует с момента
  // подписки), и из TelegramPersonalService (PERSONAL_DM через MTProto — там Client чаще
  // всего ещё не существует, отдельного события "подписки" для личных диалогов нет, первое
  // сообщение и есть первое знакомство). landingId — только для PERSONAL_DM, где атрибуция
  // разбирается из предзаполненного текста первого сообщения (см. TelegramPersonalService).
  async recordInboundMessage(
    projectId: string,
    data: {
      tgUserId: string;
      tgUsername?: string;
      tgFirstName?: string;
      tgLastName?: string;
      landingId?: string;
      buyerId?: string;
      // Всегда false для вызовов из TelegramPersonalService (правка 2026-07-21 — у личного
      // аккаунта, включая PERSONAL_DM, нет реального понятия "подписчик", только диалог, см.
      // комментарий в telegram-personal.service.ts). Для бот-каналов первое сообщение от
      // человека, которого ещё нет в базе, значит он написал НЕ через нашу воронку — баг-репорт
      // пользователя 2026-07-17: такой Client не должен считаться подписчиком/попадать в
      // нашу статистику.
      treatAsSubscriber: boolean;
      // true только когда сообщение реально пришло через БОТА (TelegramProvider), не через
      // личный MTProto-аккаунт (TelegramPersonalService) — баг-репорт пользователя
      // 2026-07-17: пуши падали с "chat not found" для клиентов, у которых firstDialogueAt
      // (общее поле на оба источника) был выставлен исключительно перепиской с личным
      // аккаунтом — у бота с ними чата никогда не было. См. botActivatedAt в schema.prisma.
      viaBot: boolean;
      // Только для tgMode === 'BOT_DIRECT' (запрос пользователя 2026-07-21, продолжение правки
      // "диалог только с личкой") — у этого режима канала вообще нет, вся переписка и есть
      // диалог, отдельного личного аккаунта в паре с ним обычно не бывает. Остальные режимы
      // (PRIVATE_CHANNEL_REQUEST/PUBLIC_CHANNEL_DIRECT) по-прежнему считают диалог только через
      // личный аккаунт — там бот отвечает за подписку/канал, а личка за настоящий диалог.
      countBotAsDialogue?: boolean;
    },
  ): Promise<void> {
    let client = await this.findByTgId(data.tgUserId, projectId);
    if (!client) {
      client = await this.findOrCreate({
        projectId,
        landingId: data.landingId,
        buyerId: data.buyerId,
        tgUserId: data.tgUserId,
        tgUsername: data.tgUsername,
        tgFirstName: data.tgFirstName,
        tgLastName: data.tgLastName,
        channelType: 'TELEGRAM',
        markSubscribed: data.treatAsSubscriber,
      });
    }

    // "Диалог" (запрос пользователя 2026-07-21: "диалог должен считаться именно с личкой, а не
    // с ботом") — firstDialogueAt/lastDialogueAt/dialogueMessageCount и Dialogue-событие
    // фиксируются для сообщений с личного MTProto-аккаунта (viaBot: false) ВСЕГДА, а для
    // сообщений через бота (viaBot: true) — только если countBotAsDialogue (т.е. tgMode ===
    // 'BOT_DIRECT', см. комментарий у поля выше). Для PRIVATE_CHANNEL_REQUEST/
    // PUBLIC_CHANNEL_DIRECT сообщение через бота по-прежнему обновляет только
    // botActivatedAt/isBotActive ниже — отдельный, не отменённый механизм (доказательство, что
    // бот технически может прислать пуш), не диалог. Пока у такого проекта не подключён личный
    // аккаунт, "Диалог" будет пустым для всех клиентов — это ожидаемо, подтверждено
    // пользователем.
    if (data.viaBot && !data.countBotAsDialogue) {
      const patch: Prisma.ClientUpdateInput = {};
      // Тот же смысл, что и раньше: единственное надёжное доказательство "бот технически может
      // прислать этому клиенту пуш"; сброс isBotActive — тот же баг-репорт 2026-07-17
      // ("после того как пользователь написал боту и активировал его... бот не пишется как
      // активированным").
      if (!client.botActivatedAt) patch.botActivatedAt = new Date();
      if (client.isBotActive === false) patch.isBotActive = true;
      if (Object.keys(patch).length) {
        await this.prisma.client.update({ where: { id: client.id }, data: patch });
      }
      return;
    }

    // BOT_DIRECT (countBotAsDialogue) — сообщение через бота само по себе И диалог, И
    // доказательство "бот может прислать пуш" одновременно, обновляем оба набора полей.
    if (data.viaBot && data.countBotAsDialogue) {
      const patch: Prisma.ClientUpdateInput = {};
      if (!client.botActivatedAt) patch.botActivatedAt = new Date();
      if (client.isBotActive === false) patch.isBotActive = true;
      if (Object.keys(patch).length) {
        await this.prisma.client.update({ where: { id: client.id }, data: patch });
      }
    }

    await this.applyDialogueUpdate(projectId, client, data.landingId);
  }

  // Общий хвост "зафиксировать диалог" — вынесен из recordInboundMessage (запрос
  // пользователя 2026-07-21), чтобы им же могли воспользоваться оба ручных пути (см.
  // recordManualDialogue ниже: подтверждение менеджером через бота И кнопка в списке
  // клиентов) без дублирования isFirstMessage-логики и условий отправки Dialogue-события.
  // isFirstMessage — и есть проверка "диалог уже зарегистрирован?" из требования пользователя
  // "каждый вариант должен сначала проверить... перед тем как посылать его ещё раз": все три
  // способа (бот/личный аккаунт, менеджер, кнопка в CRM) сходятся сюда, событие в Facebook/
  // TikTok уходит только один раз, за какой бы способ ни отвечало первое срабатывание.
  private async applyDialogueUpdate(projectId: string, client: Client, landingId?: string): Promise<void> {
    const isFirstMessage = !client.firstDialogueAt;
    const now = new Date();
    await this.prisma.client.update({
      where: { id: client.id },
      data: {
        firstDialogueAt: client.firstDialogueAt ?? now,
        lastDialogueAt: now,
        dialogueMessageCount: { increment: 1 },
      },
    });

    if (isFirstMessage) {
      await this.trackingService.recordEvent(projectId, {
        eventName: 'Dialogue',
        clientId: client.id,
        tgUserId: client.tgUserId ?? undefined,
        landingId: client.landingId ?? landingId,
        source: 'SERVER',
      });
    }
  }

  // Ручная фиксация диалога (запрос пользователя 2026-07-21) — два вызывающих: (1)
  // TelegramProvider, после того как менеджер переслал боту сообщение клиента и подтвердил
  // ("Да") — для команд, не подключающих личный MTProto-аккаунт; (2) ClientsController, кнопка
  // "Зарегистрировать диалог" прямо в списке клиентов — для тех же случаев, но без Telegram-
  // бота вообще (клиент ведётся в другом канале целиком). projectId передан явно и
  // проверяется — защита от подделанного clientId (чужого проекта/callback_data).
  async recordManualDialogue(clientId: string, projectId: string): Promise<void> {
    const client = await this.prisma.client.findFirst({ where: { id: clientId, projectId, deletedAt: null } });
    if (!client) throw new NotFoundException('Клиент не найден');
    await this.applyDialogueUpdate(projectId, client);
  }

  // companyId передаётся явно (а не доверяется только Prisma-middleware), потому что
  // этот метод дёргается и из HTTP-контроллера (контекст есть), и потенциально из
  // фоновых задач (BullMQ воркер в 1.7/1.8, контекста AsyncLocalStorage там нет)
  async findOne(id: string, companyId: string): Promise<Client> {
    const client = await this.prisma.client.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { _count: { select: { purchases: true } } },
    });
    if (!client) throw new NotFoundException('Клиент не найден');
    return client;
  }

  async findMany(projectId: string, filters: ClientFiltersDto) {
    const where = this.buildClientFilterWhere(projectId, filters);

    let orderBy: Prisma.ClientOrderByWithRelationInput = { createdAt: 'desc' };
    if (filters.sortBy === 'totalSpent') orderBy = { totalSpent: 'desc' };
    if (filters.sortBy === 'lastActive') orderBy = { lastActiveAt: 'desc' };
    if (filters.sortBy === 'purchases') orderBy = { purchasesCount: 'desc' };

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 200);

    const [items, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { purchases: true } } },
      }),
      this.prisma.client.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // Сколько клиентов реально получат пуш (подписаны + бот не заблокирован)
  async countPushAudience(projectId: string, filters: PushFilterDto): Promise<number> {
    return this.prisma.client.count({ where: this.buildPushFilterWhere(projectId, filters) });
  }

  // Сколько клиентов попадает в сегмент вообще, без требования isSubscribed/isBotActive —
  // используется PushesService для пары audienceTotal/audienceReachable на Push (шаг 1.8)
  async countAudienceTotal(projectId: string, filters: PushFilterDto): Promise<number> {
    return this.prisma.client.count({ where: this.buildPushFilterWhere(projectId, filters, { reachableOnly: false }) });
  }

  // Курсорная выдача аудитории чанками — чтобы воркер рассылки (1.8) не грузил
  // в память сразу всю базу клиентов на крупных проектах
  async *getClientsForPushInChunks(
    projectId: string,
    filters: PushFilterDto,
    chunkSize = 200,
  ): AsyncGenerator<Client[]> {
    const where = this.buildPushFilterWhere(projectId, filters);
    let cursor: string | undefined;

    while (true) {
      const chunk = await this.prisma.client.findMany({
        where,
        orderBy: { id: 'asc' },
        take: chunkSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (chunk.length === 0) return;
      yield chunk;
      cursor = chunk[chunk.length - 1].id;
      if (chunk.length < chunkSize) return;
    }
  }

  // CSV для Facebook Custom Audience (Lookalike)
  async exportForLookalike(projectId: string, onlyBuyers: boolean): Promise<string> {
    const clients = await this.repository.getClientsForLookalikeExport(projectId, onlyBuyers);

    const headers = ['email', 'phone', 'country'];
    const rows = clients.map((c) => [c.email || '', c.waPhone || c.phone || '', c.country || '']);

    return [headers.join(','), ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join('\n');
  }

  // GDPR-удаление: помимо deletedAt, реально стираем PII (иначе это не "удаление",
  // а просто скрытие строки из выдачи) — дока этот нюанс не уточняла, но soft-delete
  // без скрабинга персональных данных не соответствует смыслу GDPR-запроса на удаление
  async softDelete(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);

    await this.prisma.client.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isSubscribed: false,
        tgUsername: null,
        tgFirstName: null,
        tgLastName: null,
        tgPhotoUrl: null,
        waName: null,
        igUsername: null,
        email: null,
        phone: null,
        ipAddress: null,
        userAgent: null,
      },
    });
  }

  // clientId уже проверен контроллером через findOne(id, companyId) перед вызовом —
  // TrackingEvent/PushLog не входят в modelsWithCompany (нет колонки companyId),
  // поэтому сами по себе не были бы изолированы по тенанту без этой проверки выше.
  async findEvents(clientId: string) {
    return this.prisma.trackingEvent.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' } });
  }

  async findPushLogs(clientId: string) {
    return this.prisma.pushLog.findMany({
      where: { clientId },
      include: { push: { select: { id: true, name: true, status: true, sentAt: true } } },
    });
  }

  private buildClientFilterWhere(projectId: string, filters: ClientFiltersDto): Prisma.ClientWhereInput {
    const where: Prisma.ClientWhereInput = { projectId, deletedAt: null };

    if (filters.channelType?.length) where.channelType = { in: filters.channelType };
    if (typeof filters.hasPurchase === 'boolean') where.hasPurchase = filters.hasPurchase;
    if (typeof filters.hasDialogue === 'boolean') where.firstDialogueAt = filters.hasDialogue ? { not: null } : null;
    if (typeof filters.isBotActive === 'boolean') where.isBotActive = filters.isBotActive;
    if (typeof filters.isSubscribed === 'boolean') where.isSubscribed = filters.isSubscribed;
    if (filters.country?.length) where.country = { in: filters.country };
    if (filters.utmSource) where.utmSource = filters.utmSource;
    if (filters.utmCampaign) where.utmCampaign = filters.utmCampaign;
    if (filters.landingId) where.landingId = filters.landingId;

    if (filters.minSpent !== undefined || filters.maxSpent !== undefined) {
      where.totalSpent = {
        ...(filters.minSpent !== undefined ? { gte: filters.minSpent } : {}),
        ...(filters.maxSpent !== undefined ? { lte: filters.maxSpent } : {}),
      };
    }

    if (filters.subscribedFrom || filters.subscribedTo) {
      where.subscribedAt = {
        ...(filters.subscribedFrom ? { gte: new Date(filters.subscribedFrom) } : {}),
        ...(filters.subscribedTo ? { lte: new Date(filters.subscribedTo) } : {}),
      };
    } else {
      // "ours" по умолчанию — список клиентов не должен вперемешку показывать холодные
      // контакты, которые просто написали в личку/боту мимо нашей ссылки/лендинга (баг-репорт
      // пользователя 2026-07-17, см. ClientsService.recordInboundMessage/findOrCreate — такие
      // Client создаются с subscribedAt: null). Они не теряются — origin=external показывает
      // именно их, отдельно, не влияя на этот дефолтный вид/статистику.
      const origin = filters.origin ?? 'ours';
      if (origin === 'ours') where.subscribedAt = { not: null };
      else if (origin === 'external') where.subscribedAt = null;
    }

    if (filters.search) {
      where.OR = [
        { tgUsername: { contains: filters.search, mode: 'insensitive' } },
        { tgFirstName: { contains: filters.search, mode: 'insensitive' } },
        { tgLastName: { contains: filters.search, mode: 'insensitive' } },
        { waPhone: { contains: filters.search } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { waName: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private buildPushFilterWhere(
    projectId: string,
    filters: PushFilterDto,
    opts: { reachableOnly?: boolean } = { reachableOnly: true },
  ): Prisma.ClientWhereInput {
    const where: Prisma.ClientWhereInput = { projectId, deletedAt: null };
    // "Доступен для пуша" — два независимых условия:
    // 1. isBotActive: true — бот технически может доставить (снимается только на реальный
    //    403 от Telegram, см. markBotBlocked), а НЕ isSubscribed — отписка от канала
    //    (markUnsubscribed) не отзывает у бота возможность личных сообщений (баг-репорт
    //    пользователя 2026-07-17: "mrphsx отписался, но бот у него всё ещё активен" — раньше
    //    isSubscribed тоже требовался и ошибочно исключал отписавшихся).
    // 2. subscribedAt: not null ИЛИ botActivatedAt: not null — но isBotActive один
    //    НЕДОСТАТОЧЕН: он по умолчанию true у вообще любого Client с момента создания (флип
    //    в false только при 403), в т.ч. у "холодных" контактов, у которых с ботом никогда
    //    не было чата вообще (попытка отправки упадёт с "chat not found"). subscribedAt
    //    устанавливается ТОЛЬКО настоящим событием подписки (см.
    //    feedback_cold_contact_subscribe_bug) и НЕ сбрасывается при отписке — надёжный
    //    "точно был нашим реальным клиентом" маркер, независимый от isSubscribed: mrphsx
    //    (subscribedAt задан, isSubscribed:false) проходит.
    //    botActivatedAt добавлен отдельно (запрос пользователя 2026-07-17: "пользователь
    //    который не активировал бота пишет что он его заблокировал... показывай доступными
    //    для пушей, так как другие не могут получить рассылку") — реальный человек, который
    //    хоть раз написал БОТУ (не личному MTProto-аккаунту — см. ClientsService.
    //    recordInboundMessage, viaBot), точно может получить сообщение, даже если он никогда
    //    не был подписан ни на один канал (subscribedAt: null). НЕ используем firstDialogueAt
    //    здесь — оно общее на бота И личный аккаунт, и второй раунд этого же бага (массовые
    //    "chat not found") случился именно из-за того, что firstDialogueAt мог прийти
    //    исключительно от личного аккаунта, с которым у бота никогда не было чата.
    if (opts.reachableOnly !== false) {
      where.isBotActive = true;
      where.OR = [{ subscribedAt: { not: null } }, { botActivatedAt: { not: null } }];
    }

    if (filters.channelTypes?.length) where.channelType = { in: filters.channelTypes };
    if (typeof filters.hasPurchase === 'boolean') where.hasPurchase = filters.hasPurchase;
    if (filters.countries?.length) where.country = { in: filters.countries };
    if (filters.minSpent !== undefined) where.totalSpent = { gte: filters.minSpent };

    if (filters.subscribedFrom || filters.subscribedTo) {
      where.subscribedAt = {
        ...(filters.subscribedFrom ? { gte: new Date(filters.subscribedFrom) } : {}),
        ...(filters.subscribedTo ? { lte: new Date(filters.subscribedTo) } : {}),
      };
    }

    if (filters.inactiveDaysMin !== undefined) {
      where.lastActiveAt = { lte: new Date(Date.now() - filters.inactiveDaysMin * 24 * 60 * 60 * 1000) };
    }

    return where;
  }

  // ip-api.com: бесплатно до 1000 запросов/мин, без ключа. Глобальный fetch (Node 20+)
  // вместо отдельной axios-зависимости — она не была установлена и не нужна для одного вызова.
  private async getGeoByIp(ip: string): Promise<{ country?: string; city?: string }> {
    if (['127.0.0.1', '::1', 'localhost'].includes(ip) || ip.startsWith('192.168') || ip.startsWith('10.')) {
      return {};
    }

    try {
      const response = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,status`, {
        signal: AbortSignal.timeout(2000),
      });
      const json = (await response.json()) as { status: string; country?: string; city?: string };
      if (json.status === 'success') {
        return { country: json.country, city: json.city };
      }
    } catch (error) {
      this.logger.warn(`Geo IP lookup failed for ${ip}: ${(error as Error).message}`);
    }
    return {};
  }

  private buildIdentityWhere(
    projectId: string,
    data: Pick<FindOrCreateClientInput, 'tgUserId' | 'waPhone' | 'igUserId'>,
  ) {
    if (data.tgUserId) return { projectId, tgUserId: data.tgUserId };
    if (data.waPhone) return { projectId, waPhone: data.waPhone };
    if (data.igUserId) return { projectId, igUserId: data.igUserId };
    throw new Error('findOrCreate requires at least one channel identity (tgUserId/waPhone/igUserId)');
  }
}
