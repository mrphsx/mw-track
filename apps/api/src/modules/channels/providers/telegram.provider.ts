import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BotScenario, BotScenarioTrigger, Channel, Client } from '@prisma/client';
import { Queue } from 'bull';
import { Bot, Context, GrammyError, InputFile } from 'grammy';
import { ClientLimitReachedException, ClientsService } from '../../clients/clients.service';
import { PurchasesService } from '../../clients/purchases.service';
import { TrackingService } from '../../tracking/tracking.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { ChannelProvider, SendMessageOptions, SendMessageResult, UserStatus } from './channel.provider.interface';
import { ApproveJoinRequestJob } from '../join-request-approval.processor';
import { ScenarioMessageJob } from '../bot-scenario-message.processor';
import { VideoProcessingService } from '../video-processing.service';

@Injectable()
export class TelegramProvider implements ChannelProvider {
  private readonly logger = new Logger(TelegramProvider.name);
  private bots = new Map<string, Bot>(); // channelId -> Bot instance

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private clientsService: ClientsService,
    private purchasesService: PurchasesService,
    private trackingService: TrackingService,
    private config: ConfigService,
    private videoProcessing: VideoProcessingService,
    @InjectQueue('join-request-approval') private joinRequestQueue: Queue<ApproveJoinRequestJob>,
    @InjectQueue('bot-scenario-message') private scenarioQueue: Queue<ScenarioMessageJob>,
  ) {}

  getBot(channelId: string): Bot | undefined {
    return this.bots.get(channelId);
  }

  async initialize(channel: Channel): Promise<void> {
    const mode = channel.tgMode || 'BOT_DIRECT';

    // PERSONAL_DM — не бот, а статичная ссылка на личный аккаунт: нет токена, нет
    // вебхука, нет API-вызовов вообще. Лендинг ведёт прямо на https://t.me/<username>
    // (см. LandingRendererService.buildTelegramLink) — initialize() здесь только
    // проверяет, что username указан, остальное не настраивается.
    if (mode === 'PERSONAL_DM') {
      if (!channel.tgPersonalUsername) {
        throw new Error('Укажите username личного аккаунта — без него лендинг не будет знать, куда вести');
      }
      return;
    }

    if (!channel.tgBotToken) throw new Error('Bot token required');

    if (mode === 'PUBLIC_CHANNEL_DIRECT' && !channel.tgChannelUsername) {
      throw new Error('Укажите публичный @username канала — без него лендинг не может вести в канал напрямую');
    }
    if ((mode === 'PRIVATE_CHANNEL_REQUEST' || mode === 'PUBLIC_CHANNEL_DIRECT') && !channel.tgChannelId) {
      throw new Error('Укажите Channel ID — для этого режима он обязателен (нужен боту для проверки прав и одобрения заявок)');
    }

    const bot = new Bot(channel.tgBotToken);

    // Менеджеры (запрос пользователя 2026-07-21) — перехватывается ПЕРВЫМ, до любых
    // bot.command/bot.on ниже, чтобы поймать сообщение от менеджера независимо от его типа
    // (пересланное медиа без подписи не дошло бы до message:text) и не дать ему создать Client
    // /попасть в сценарии — иначе менеджер мог бы случайно получить пуш/автоворонку этого бота.
    // Быстрый выход, если у канала вообще нет менеджеров — основной путь для всех остальных.
    bot.use(async (ctx, next) => {
      if (
        (channel.tgManagerUsernames?.length ?? 0) > 0 &&
        ctx.message &&
        this.isManager(channel, ctx.from?.username)
      ) {
        await this.handleManagerMessage(ctx, channel);
        return;
      }
      await next();
    });

    bot.callbackQuery(/^mgr_dlg_yes:(.+)$/, async (ctx) => {
      if (!this.isManager(channel, ctx.from?.username)) {
        await ctx.answerCallbackQuery();
        return;
      }
      const clientId = ctx.match[1];
      try {
        await this.clientsService.recordManualDialogue(clientId, channel.projectId);
        await ctx.answerCallbackQuery({ text: 'Диалог записан' });
        await ctx.editMessageReplyMarkup();
        const text = ctx.callbackQuery.message?.text;
        if (text) await ctx.editMessageText(`${text}\n\n✅ Записано`);
      } catch (error) {
        this.logger.warn(`mgr_dlg_yes failed for channel ${channel.id}: ${(error as Error).message}`);
        await ctx.answerCallbackQuery({ text: 'Ошибка, попробуйте ещё раз' });
      }
    });

    bot.callbackQuery('mgr_dlg_no', async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup();
    });

    bot.on('chat_join_request', async (ctx) => {
      await this.handleJoinRequest(ctx, channel);
    });

    bot.command('start', async (ctx) => {
      await this.handleStart(ctx, channel);
    });

    bot.command('purchase', async (ctx) => {
      await this.handlePurchaseCommand(ctx, channel);
    });

    // Сценарии бота (команды + дефолт) — регистрируется ПОСЛЕ bot.command('start'/'purchase')
    // выше: grammy не идёт дальше по цепочке обработчиков, если более ранний уже сработал,
    // так что этот catch-all в принципе не увидит апдейты, уже перехваченные /start и
    // /purchase — исключать их вручную не нужно. Любой другой текст, начинающийся с "/",
    // ищется как пользовательская команда (BotScenario.triggerType=COMMAND); всё остальное —
    // дефолтное сообщение (triggerType=DEFAULT), если оно настроено.
    bot.on('message:text', async (ctx) => {
      await this.handleIncomingText(ctx, channel);
    });

    // chat_member — статус ДРУГОГО участника (не бота) в чате. Срабатывает для обычного
    // вступления в публичный канал/группу, где approval не требуется (в отличие от
    // chat_join_request, который шлётся только если у канала включено "Запрашивать вступление").
    // Требует, чтобы бот был администратором, И явного allowed_updates при setWebhook —
    // по умолчанию Telegram chat_member не присылает вообще (см. ниже).
    bot.on('chat_member', async (ctx) => {
      await this.handleChatMemberUpdate(ctx, channel);
    });

    bot.on('my_chat_member', async (ctx) => {
      await this.handleMemberUpdate(ctx, channel);
    });

    bot.catch((err) => {
      this.logger.error(`Unhandled error in bot for channel ${channel.id}: ${err.message}`);
    });

    // grammy требует bot.init() (внутренний getMe(), заполняет bot.botInfo) до того,
    // как handleUpdate() сможет обрабатывать апдейты — без этого вызова вебхуки
    // в проде падали бы с "Bot not initialized" на каждом входящем апдейте,
    // даже с валидным токеном, потому что setWebhook сам init() не делает.
    await bot.init();

    // bot.init() уже знает username (через getMe()) — сохраняем его в Channel, иначе
    // tgBotUsername остаётся null навсегда и tg://-ссылка на лендинге (см.
    // ../telegram-link.util.ts) никогда не будет рабочей.
    if (bot.botInfo.username && bot.botInfo.username !== channel.tgBotUsername) {
      await this.prisma.channel.update({ where: { id: channel.id }, data: { tgBotUsername: bot.botInfo.username } });
    }

    // Проверяем СРАЗУ при подключении, что бот реально админ канала — без этого
    // approveChatJoinRequest/chat_member вебхуки молча не работают, и пользователь
    // узнаёт об этом только тогда, когда подписчики "не доходят", а не сразу при настройке.
    if (channel.tgChannelId) {
      let member: Awaited<ReturnType<typeof bot.api.getChatMember>>;
      try {
        member = await bot.api.getChatMember(channel.tgChannelId, bot.botInfo.id);
      } catch (error) {
        throw new Error(`Не удалось проверить права бота в канале: ${(error as Error).message}`);
      }
      if (!['administrator', 'creator'].includes(member.status)) {
        throw new Error('Бот не является администратором канала — добавьте его в администраторы канала и повторите');
      }
    }

    // PRIVATE_CHANNEL_REQUEST: invite-ссылка с creates_join_request:true — единственный
    // способ получить нормальный "Request to Join" UX в приватном канале (обычная
    // exportChatInviteLink даёт мгновенное вступление без approval). Создаём один раз и
    // кэшируем в БД — повторные initialize() (reactivate/update) не плодят новые ссылки.
    // Это ОБЩАЯ ссылка канала — fallback для захода в бота напрямую, минуя лендинг (см.
    // handleStart). У каждого лендинга есть СВОЯ отдельная ссылка (Landing.tgInviteLink,
    // см. createLandingInviteLink ниже, вызывается из LandingsService.publish()) — именно
    // она даёт точную атрибуцию "какой лендинг привёл подписчика" в handleJoinRequest.
    if (mode === 'PRIVATE_CHANNEL_REQUEST' && channel.tgChannelId && !channel.tgInviteLink) {
      try {
        const inviteLink = await this.createInviteLink(bot, channel.tgChannelId, 'TrafficCRM landing');
        await this.prisma.channel.update({ where: { id: channel.id }, data: { tgInviteLink: inviteLink } });
        channel.tgInviteLink = inviteLink;
      } catch (error) {
        throw new Error(`Не удалось создать invite-ссылку канала: ${(error as Error).message}`);
      }
    }

    // Доп. метаданные из Telegram — только для отображения карточки канала в UI (название,
    // фото, число участников), не критичны для работы канала. Поэтому отдельный try/catch:
    // ошибка здесь не должна ронять initialize() целиком (бот уже инициализирован и рабочий).
    await this.fetchAndSaveMetadata(bot, channel);

    // setWebhook требует реальный публичный HTTPS URL и валидный токен —
    // в локальной разработке без ngrok/реального бота это ожидаемо упадёт.
    // initialize() поэтому регистрирует bot в bots-карте даже при ошибке setWebhook,
    // чтобы handleUpdate() (вызываемый из WebhooksController) мог быть протестирован
    // напрямую синтетическими апдейтами без сети.
    this.bots.set(channel.id, bot);

    const webhookUrl = `${this.config.get<string>('API_URL')}/api/v1/webhooks/telegram/${channel.id}`;
    // allowed_updates явно — chat_member НЕ входит в дефолтный набор Telegram (вместе с
    // message_reaction/message_reaction_count), без явного перечисления вступления в публичный
    // канал (без approval) никогда бы не дошли до бота. callback_query добавлен 2026-07-21
    // (баг-репорт пользователя: нажатие "Да" в диалоге с менеджером ничего не делало и бот
    // молчал, без единой ошибки в логах) — этого типа тоже не было в списке, поэтому Telegram
    // вообще не присылал апдейты о нажатии inline-кнопок на этот вебхук, ни разу, с самого
    // начала (проблема была не только у новой фичи с менеджерами — mgr_dlg_yes/no, WelcomeButtons/
    // scenario-кнопки — все они были URL-кнопками до сих пор, поэтому не проявлялось раньше).
    await bot.api.setWebhook(webhookUrl, {
      allowed_updates: ['message', 'chat_join_request', 'my_chat_member', 'chat_member', 'callback_query'],
    });
  }

  // creates_join_request:true — общий механизм и для общей ссылки канала (initialize()
  // выше), и для персональных ссылок лендингов (createLandingInviteLink ниже). Вынесено в
  // отдельный метод, чтобы не дублировать вызов + оборачивание ошибки в двух местах.
  private async createInviteLink(bot: Bot, chatId: string, name: string): Promise<string> {
    const invite = await bot.api.createChatInviteLink(chatId, { name, creates_join_request: true });
    return invite.invite_link;
  }

  // Персональная invite-ссылка лендинга — вызывается из LandingsService.publish(), не при
  // каждом рендере страницы (внешний Telegram API-вызов не место в горячем пути рендера).
  // Возвращает null, если у канала нет смысла создавать ссылку (не Telegram/не
  // PRIVATE_CHANNEL_REQUEST/канал ещё не инициализирован) — вызывающий код просто не
  // проставляет Landing.tgInviteLink в этом случае, лендинг продолжает работать через
  // общую ссылку канала (Channel.tgInviteLink), просто без пер-лендинговой атрибуции.
  async createLandingInviteLink(channel: Channel, landingName: string): Promise<string | null> {
    if (channel.type !== 'TELEGRAM' || channel.tgMode !== 'PRIVATE_CHANNEL_REQUEST' || !channel.tgChannelId) return null;

    const bot = this.getBot(channel.id);
    if (!bot) {
      this.logger.warn(`createLandingInviteLink: канал ${channel.id} ещё не инициализирован`);
      return null;
    }

    try {
      return await this.createInviteLink(bot, channel.tgChannelId, landingName);
    } catch (error) {
      this.logger.warn(`createLandingInviteLink failed for channel ${channel.id}: ${(error as Error).message}`);
      return null;
    }
  }

  // Подтягивает название/число участников/фото из Telegram, чтобы карточка канала в UI сразу
  // показывала реальные данные, а не только то, что пользователь вручную ввёл при подключении.
  // Фото канала приоритетнее фото бота (более узнаваемо для пользователя), фото бота — fallback,
  // если канала нет (BOT_DIRECT) или у канала фото не установлено.
  private async fetchAndSaveMetadata(bot: Bot, channel: Channel): Promise<void> {
    try {
      const data: { tgBotId: string; tgBotFirstName: string; tgChannelTitle?: string; tgChannelMembersCount?: number; tgAvatarFileId?: string } = {
        tgBotId: String(bot.botInfo.id),
        tgBotFirstName: bot.botInfo.first_name,
      };

      if (channel.tgChannelId) {
        const chat = await bot.api.getChat(channel.tgChannelId);
        if (chat.title) data.tgChannelTitle = chat.title;
        if (chat.photo) data.tgAvatarFileId = chat.photo.big_file_id;
        try {
          data.tgChannelMembersCount = await bot.api.getChatMemberCount(channel.tgChannelId);
        } catch {
          // не у всех типов чатов доступно (например, каналов без публичной статистики) — не критично
        }
      }

      if (!data.tgAvatarFileId) {
        const botChat = await bot.api.getChat(bot.botInfo.id);
        if (botChat.photo) data.tgAvatarFileId = botChat.photo.big_file_id;
      }

      await this.prisma.channel.update({ where: { id: channel.id }, data });
    } catch (error) {
      this.logger.warn(`Не удалось получить метаданные Telegram для канала ${channel.id}: ${(error as Error).message}`);
    }
  }

  // Профильное фото самого клиента (не путать с fetchAndSaveMetadata — то фото канала/бота).
  // Не критичный сбой — тот же принцип, что и у fetchAndSaveMetadata, не должен ронять
  // обработку join/chat_member при таймауте/ошибке Telegram.
  private async fetchProfilePhotoFileId(bot: Bot, tgUserId: number): Promise<string | undefined> {
    try {
      const photos = await bot.api.getUserProfilePhotos(tgUserId, { limit: 1 });
      const sizes = photos.photos[0];
      return sizes?.[sizes.length - 1]?.file_id;
    } catch (error) {
      this.logger.warn(`fetchProfilePhotoFileId failed for user ${tgUserId}: ${(error as Error).message}`);
      return undefined;
    }
  }

  // Приблизительная страна клиента для PRIVATE_CHANNEL_REQUEST (запрос пользователя
  // 2026-07-04) — Telegram Bot API вообще не отдаёт страну пользователя, единственный
  // источник — IP визита на лендинг, закэшированный LandingRendererService в Redis на 5 минут
  // (ключ landing-visit-country:{landingId}). Осознанно приблизительно: если на лендинг
  // почти одновременно зайдёт два разных человека, может подставиться не тот — согласовано.
  private async getCachedLandingCountry(landingId: string | undefined): Promise<string | undefined> {
    if (!landingId) return undefined;
    const cached = await this.redis.get(`landing-visit-country:${landingId}`);
    return cached ?? undefined;
  }

  // Метка баера (Фаза 3.6, Team Analytics) — тот же приём и та же приблизительность, что и у
  // getCachedLandingCountry выше, тот же 5-минутный кэш по landingId
  // (LandingRendererService.injectTrackingScripts).
  private async getCachedLandingBuyer(landingId: string | undefined): Promise<string | undefined> {
    if (!landingId) return undefined;
    const cached = await this.redis.get(`landing-visit-buyer:${landingId}`);
    return cached ?? undefined;
  }

  private async handleJoinRequest(ctx: Context, channel: Channel) {
    const tgUser = ctx.chatJoinRequest?.from;
    if (!tgUser) return;

    // Telegram сообщает боту, через какую именно invite-ссылку пришла заявка
    // (ctx.chatJoinRequest.invite_link.invite_link). Сначала проверяем совпадение с
    // персональной ссылкой КОНКРЕТНОГО лендинга (Landing.tgInviteLink) — это даёт точную
    // пер-лендинговую атрибуцию (запрос пользователя 2026-07-02: "подписчики отдельно на
    // каждый лэнд"); если не нашли — проверяем общую ссылку канала (Channel.tgInviteLink,
    // fallback для захода в бота напрямую, минуя любой лендинг). У канала может быть и
    // третья invite-ссылка (например, созданная вручную админом отдельно от CRM) — заявки
    // по ней тоже одобряем (не мешаем людям вступать в канал), но НЕ заводим
    // Client/Subscribe: в CRM должны попадать только реальные подписчики с лендинга/бота,
    // а не все подряд, кто нашёл канал другим путём.
    const usedInviteLink = ctx.chatJoinRequest?.invite_link?.invite_link;
    let landingId: string | undefined;
    let isFromOurLanding = false;

    if (usedInviteLink) {
      const landing = await this.prisma.landing.findFirst({
        where: { projectId: channel.projectId, tgInviteLink: usedInviteLink, deletedAt: null },
        select: { id: true },
      });
      if (landing) {
        landingId = landing.id;
        isFromOurLanding = true;
      } else if (usedInviteLink === channel.tgInviteLink) {
        isFromOurLanding = true;
      }
    }

    if (!isFromOurLanding) {
      try {
        await this.approveJoinRequestMaybeDelayed(ctx.chatJoinRequest!.chat.id, tgUser.id, channel, false);
      } catch (error) {
        this.logger.error(`Error approving untracked join request for channel ${channel.id}: ${(error as Error).message}`);
      }
      return;
    }

    try {
      const bot = this.bots.get(channel.id);
      const [tgPhotoUrl, country, buyerId] = await Promise.all([
        bot ? this.fetchProfilePhotoFileId(bot, tgUser.id) : undefined,
        this.getCachedLandingCountry(landingId),
        this.getCachedLandingBuyer(landingId),
      ]);

      const client = await this.clientsService.findOrCreate({
        projectId: channel.projectId,
        landingId,
        buyerId,
        tgUserId: String(tgUser.id),
        tgUsername: tgUser.username,
        tgFirstName: tgUser.first_name,
        tgLastName: tgUser.last_name,
        tgLanguage: tgUser.language_code,
        tgIsPremium: tgUser.is_premium ?? false,
        tgPhotoUrl,
        country,
        channelType: 'TELEGRAM',
        subscribedAt: new Date(),
      });

      // Client/Subscribe-событие (и пиксели через recordEvent) пишутся ДО одобрения и
      // независимо от задержки — согласовано с пользователем 2026-07-03: атрибуция для
      // рекламных площадок фиксируется в момент реальной заявки, искусственная задержка
      // одобрения не должна её сдвигать. Откладывается только сам approveChatJoinRequest
      // (и вместе с ним — приветственное сообщение, см. approveJoinRequestMaybeDelayed).
      await this.trackingService.recordEvent(channel.projectId, {
        eventName: 'Subscribe',
        clientId: client.id,
        tgUserId: String(tgUser.id),
        landingId,
        source: 'SERVER',
      });

      await this.approveJoinRequestMaybeDelayed(ctx.chatJoinRequest!.chat.id, tgUser.id, channel, true);
    } catch (error) {
      if (error instanceof ClientLimitReachedException) {
        await ctx.api.declineChatJoinRequest(ctx.chatJoinRequest!.chat.id, tgUser.id);
        return;
      }
      this.logger.error(`Error handling join request for channel ${channel.id}: ${(error as Error).message}`);
    }
  }

  // channel.tgJoinDelaySeconds > 0 — approve (и приветствие) уходят отложенной BullMQ-джобой
  // (JoinRequestApprovalProcessor) вместо синхронного вызова прямо в вебхуке. 0/null — прежнее
  // поведение без каких-либо изменений, очередь даже не участвует.
  private async approveJoinRequestMaybeDelayed(chatId: number, tgUserId: number, channel: Channel, sendWelcome: boolean): Promise<void> {
    if (channel.tgJoinDelaySeconds && channel.tgJoinDelaySeconds > 0) {
      await this.joinRequestQueue.add(
        'approve-join-request',
        { channelId: channel.id, chatId, tgUserId, sendWelcome },
        { delay: channel.tgJoinDelaySeconds * 1000, removeOnComplete: true, removeOnFail: 50 },
      );
      return;
    }

    const bot = this.bots.get(channel.id);
    if (!bot) {
      this.logger.warn(`approveJoinRequestMaybeDelayed: нет инстанса бота для канала ${channel.id}`);
      return;
    }
    try {
      await bot.api.approveChatJoinRequest(chatId, tgUserId);
    } catch (error) {
      // USER_ALREADY_PARTICIPANT — пользователь уже состоит в канале (повторная заявка тем же
      // аккаунтом без выхода из канала между попытками, живой репорт пользователя 2026-07-21) —
      // "принять в канал" уже неактуально, но Client/Subscribe только что записан как НОВЫЙ
      // подписчик (см. recordEvent выше в handleJoinRequest) — приветствие должно уйти всё
      // равно. Любая другая ошибка (например HIDE_REQUESTER_MISSING — заявку отозвали) означает,
      // что реального вступления не произошло — пробрасываем как раньше, без приветствия.
      if (!(error instanceof GrammyError && /USER_ALREADY_PARTICIPANT/.test(error.description))) {
        throw error;
      }
    }
    if (sendWelcome) await this.sendWelcomeMessage(String(tgUserId), channel);
  }

  private async handleStart(ctx: Context, channel: Channel) {
    const startParam = ctx.match as string;

    // /start — стандартный способ "активировать" бота в Telegram (в т.ч. после разблокировки:
    // нажатие Start шлёт именно /start, не произвольный текст) — раньше этот хендлер вообще
    // не вызывал recordInboundMessage (это делал только catch-all handleIncomingText ниже, до
    // которого /start в принципе не доходит — grammy останавливается на первом сработавшем
    // обработчике). Из-за этого isBotActive никогда не сбрасывался обратно в true после
    // разблокировки через Start, а firstDialogueAt/lastDialogueAt не обновлялись вовсе для
    // ботов, где основной сценарий входа — именно /start (баг-репорт пользователя 2026-07-17:
    // "после того как пользователь написал боту и активировал его... бот не пишется как
    // активированным").
    if (ctx.from?.id) {
      try {
        await this.clientsService.recordInboundMessage(channel.projectId, {
          tgUserId: String(ctx.from.id),
          tgUsername: ctx.from.username,
          tgFirstName: ctx.from.first_name,
          tgLastName: ctx.from.last_name,
          treatAsSubscriber: false,
          viaBot: true,
          countBotAsDialogue: channel.tgMode === 'BOT_DIRECT',
        });
      } catch (error) {
        this.logger.warn(`recordInboundMessage (start) failed for channel ${channel.id}: ${(error as Error).message}`);
      }
    }

    if (startParam) {
      const trackingDataRaw = await this.redis.get(`start:${startParam}`);
      if (trackingDataRaw) {
        const {
          fbclid,
          ttclid,
          utmSource,
          utmCampaign,
          pixelId,
          adId,
          adName,
          adsetId,
          adsetName,
          campaignId,
          campaignName,
          placement,
          siteSourceName,
          buyerRef,
        } = JSON.parse(trackingDataRaw);

        await this.clientsService.updateTracking(String(ctx.from?.id), channel.projectId, {
          fbclid,
          ttclid,
          utmSource,
          utmCampaign,
          pixelId,
          adId,
          adName,
          adsetId,
          adsetName,
          campaignId,
          campaignName,
          placement,
          siteSourceName,
          buyerId: buyerRef,
        });

        // Одноразовый код — удаляется после использования
        await this.redis.del(`start:${startParam}`);
      }
    }

    // Убрано 2026-07-21 (запрос пользователя): раньше здесь для PRIVATE_CHANNEL_REQUEST
    // отправлялось сообщение с кнопкой "Подать заявку на вступление" — актуально было только
    // пока заявки требовали ручного нажатия. Заявки в chat_join_request одобряются автоматически
    // (см. approveJoinRequestMaybeDelayed ниже) без участия /start вообще — а это сообщение к
    // тому же ошибочно переиспользовало channel.tgWelcomeMessage (тот предназначен для
    // отправки ПОСЛЕ одобрения заявки, см. sendWelcomeMessage), из-за чего выглядело так, будто
    // приветственное сообщение уже ушло, хотя реальная отправка после approve могла не сработать.
  }

  private async handlePurchaseCommand(ctx: Context, channel: Channel) {
    if (!channel.tgChannelId) {
      await ctx.reply('❌ Канал ещё не настроен (отсутствует tgChannelId)');
      return;
    }

    // Дока сама отмечает "только для админов канала", но не даёт код проверки —
    // без неё любой написавший боту в личку мог бы регистрировать чужие покупки
    // и засорять Purchase-события, искажая оптимизацию рекламы в FB/TikTok.
    try {
      const member = await ctx.api.getChatMember(channel.tgChannelId, ctx.from!.id);
      if (!['administrator', 'creator'].includes(member.status)) {
        await ctx.reply('❌ Команда доступна только администраторам канала');
        return;
      }
    } catch (error) {
      this.logger.warn(`/purchase admin check failed for channel ${channel.id}: ${(error as Error).message}`);
      await ctx.reply('❌ Не удалось проверить права доступа');
      return;
    }

    const args = (ctx.match as string)?.split(' ') || [];
    if (args.length < 2) {
      await ctx.reply('❌ Неверный формат.\nИспользуй: /purchase @username 150\nили: /purchase 123456789 150 USD');
      return;
    }

    const identifier = args[0];
    const amount = parseFloat(args[1]);
    const currency = args[2] || 'USD';

    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('❌ Неверная сумма');
      return;
    }

    const client = identifier.startsWith('@')
      ? await this.clientsService.findByUsername(identifier.slice(1), channel.projectId)
      : await this.clientsService.findByTgId(identifier, channel.projectId);

    if (!client) {
      await ctx.reply(`❌ Клиент ${identifier} не найден в базе`);
      return;
    }

    await this.purchasesService.create(channel.projectId, client.id, { amount, currency, source: 'bot' });

    const name = client.tgFirstName || client.tgUsername || 'Клиент';
    await ctx.reply(`✅ Покупка зарегистрирована!\n👤 ${name}\n💰 ${amount} ${currency}\n📊 Событие записано для аналитики`);
  }

  // Список менеджеров (запрос пользователя 2026-07-21) — регистронезависимое сравнение,
  // username в БД уже нормализован без "@" (см. CreateChannelDto.tgManagerUsernames).
  private isManager(channel: Channel, username?: string): boolean {
    if (!username) return false;
    return (channel.tgManagerUsernames ?? []).some((u) => u.toLowerCase() === username.toLowerCase());
  }

  // Единственный вход для сообщений от менеджера — команда не хочет подключать личный
  // MTProto-аккаунт, но всё равно ведёт диалоги с клиентами вне системы (свой личный Telegram,
  // WhatsApp и т.п.) и хочет фиксировать это как "Диалог". Менеджер может: (1) переслать
  // сообщение клиента — Telegram кладёт настоящего автора пересылки в forward_origin; (2) если
  // у автора включена приватность "скрывать отправителя при пересылке" (частый случай, узнать
  // личность в этом варианте технически невозможно — ограничение самого Telegram, не нашего
  // кода), прислать вместо пересылки просто @username или числовой user_id клиента текстом —
  // запрос пользователя 2026-07-21: "многие скрывают данные при пересылке... чтобы я не
  // отправил он должен понять и найти". Тот же identifier-паттерн ("@" → username, иначе
  // tgUserId), что уже использует /purchase.
  private async handleManagerMessage(ctx: Context, channel: Channel): Promise<void> {
    const origin = ctx.message?.forward_origin;

    let client: Client | null = null;
    let notFoundLabel = '';

    if (origin) {
      if (origin.type !== 'user') {
        await ctx.reply(
          'Не удалось определить отправителя — Telegram скрывает эти данные для этого типа пересылки. ' +
            'Пришлите вместо этого его @username или user_id текстом.',
        );
        return;
      }
      const senderId = String(origin.sender_user.id);
      client = await this.clientsService.findByTgId(senderId, channel.projectId);
      notFoundLabel = origin.sender_user.username ? `@${origin.sender_user.username}` : senderId;
    } else {
      const identifier = ctx.message?.text?.trim();
      if (!identifier) {
        await ctx.reply('Перешлите сообщение клиента, либо пришлите его @username или user_id, чтобы записать диалог.');
        return;
      }
      client = identifier.startsWith('@')
        ? await this.clientsService.findByUsername(identifier.slice(1), channel.projectId)
        : await this.clientsService.findByTgId(identifier, channel.projectId);
      notFoundLabel = identifier;
    }

    if (!client) {
      await ctx.reply(`Клиент ${notFoundLabel} не найден среди клиентов проекта.`);
      return;
    }

    const label = client.tgFirstName || client.tgUsername || client.tgUserId || client.id;
    await ctx.reply(`Найден клиент: ${label}. Записать диалог?`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Да, диалог', callback_data: `mgr_dlg_yes:${client.id}` },
            { text: '❌ Нет', callback_data: 'mgr_dlg_no' },
          ],
        ],
      },
    });
  }

  private async handleMemberUpdate(ctx: Context, channel: Channel) {
    // my_chat_member — статус самого БОТА в чате (не обычного участника). Bot API шлёт это
    // событие в ДВУХ принципиально разных случаях (см. документацию типа ChatMemberUpdated):
    // 1) chat.type === 'private' — это ЕДИНСТВЕННЫЙ случай, когда Telegram вообще присылает
    //    my_chat_member для приватного чата: пользователь заблокировал ('kicked') или
    //    разблокировал ('member') бота лично у себя. Это НЕ имеет отношения к самому каналу.
    // 2) chat — реальная группа/канал (channel.tgChannelId) — тут 'left'/'kicked' значит
    //    бота выгнали ИЗ КАНАЛА, это уже настоящая причина деактивировать весь канал.
    // Раньше эти два случая не различались — ЛЮБАЯ блокировка бота ОДНИМ пользователем
    // деактивировала ВЕСЬ канал целиком (баг-репорт пользователя 2026-07-18: "когда
    // пользователь заблокировал бота, телеграм канал отключился от моей CRM").
    const chat = ctx.myChatMember?.chat;
    const newStatus = ctx.myChatMember?.new_chat_member.status;
    if (!chat || !newStatus) return;

    if (chat.type === 'private') {
      const tgUserId = String(chat.id);
      if (newStatus === 'kicked') {
        this.logger.warn(`User ${tgUserId} blocked the bot for channel ${channel.id}`);
        await this.clientsService.markBotBlocked(tgUserId, channel.projectId);
      } else if (newStatus === 'member') {
        // Прямой сигнал разблокировки в реальном времени от самого Telegram — надёжнее и
        // быстрее, чем ждать входящего сообщения (recordInboundMessage/viaBot, см.
        // feedback_client_bot_activated_status) — оставляем оба механизма, они подстраховывают
        // друг друга, а не заменяют один другой.
        this.logger.log(`User ${tgUserId} unblocked the bot for channel ${channel.id}`);
        await this.clientsService.markBotUnblocked(tgUserId, channel.projectId);
      }
      return;
    }

    // Сам канал/группа — бота реально кикнули/он вышел, деактивируем канал целиком (исходное
    // поведение, чтобы health-check и UI сразу отражали реальное состояние).
    if (newStatus === 'left' || newStatus === 'kicked') {
      this.logger.warn(`Bot removed from chat for channel ${channel.id} (status=${newStatus})`);
      await this.prisma.channel.update({
        where: { id: channel.id },
        data: { isActive: false },
      });
      this.bots.delete(channel.id);
    }
  }

  // chat_member — статус ДРУГОГО участника (не бота). Покрывает вступление в публичный
  // канал/группу, где approval не требуется (chat_join_request там вообще не шлётся) —
  // без этого обработчика такие подписчики никогда не попадали бы в базу.
  private async handleChatMemberUpdate(ctx: Context, channel: Channel) {
    const update = ctx.chatMember;
    if (!update) return;

    const wasMember = ['member', 'administrator', 'creator'].includes(update.old_chat_member.status);
    const isMember = ['member', 'administrator', 'creator'].includes(update.new_chat_member.status);
    const tgUser = update.new_chat_member.user;
    if (tgUser.is_bot) return; // защитный фильтр — статус самого бота должен идти через my_chat_member, не сюда

    if (!wasMember && isMember) {
      // chat_member срабатывает на КАЖДОЕ вступление в канал независимо от того, как
      // человек попал внутрь — в т.ч. на само одобрение заявки из handleJoinRequest (даёт
      // дубль Subscribe) и, что хуже, на вступления по ЛЮБОЙ другой invite-ссылке канала —
      // например, с лендинга другого трафик-сервиса, никак не связанного с нашей CRM.
      // Для PRIVATE_CHANNEL_REQUEST есть handleJoinRequest — единственный источник правды для
      // НАСТОЯЩЕЙ подписки воронки, с фильтрацией по invite-ссылке (наш лендинг/наш канал vs
      // чужая ссылка) — здесь эту атрибуцию так же строго не восстановить, поэтому subscribedAt
      // (влияет на статистику/рекламную атрибуцию по всему проекту, см. choke points в
      // CLAUDE.md) через эту ветку не ставим никогда (реальный баг-репорт пользователя
      // 2026-07-03: "в канал попадают по другому лендингу... и показывает их на нашей
      // платформе"). Но человек, оказавшийся в канале НЕ через нашу заявку (админ добавил
      // вручную, чужая ссылка и т.п.), — это ровно то, что пользователь просил отдельно видеть
      // 2026-07-21 ("внешние контакты... те кто подписался недавно, не по нашей воронке") —
      // фиксируем как внешнюю подписку (externalSubscribedAt), без Subscribe-события в воронку.
      if (channel.tgMode === 'PRIVATE_CHANNEL_REQUEST') {
        const existing = await this.clientsService.findByTgId(String(tgUser.id), channel.projectId);
        if (existing?.subscribedAt) return; // уже учтён через handleJoinRequest — не дублируем

        const bot = this.bots.get(channel.id);
        const tgPhotoUrl = bot ? await this.fetchProfilePhotoFileId(bot, tgUser.id) : undefined;
        await this.clientsService.findOrCreate({
          projectId: channel.projectId,
          tgUserId: String(tgUser.id),
          tgUsername: tgUser.username,
          tgFirstName: tgUser.first_name,
          tgLastName: tgUser.last_name,
          tgLanguage: tgUser.language_code,
          tgIsPremium: tgUser.is_premium ?? false,
          tgPhotoUrl,
          channelType: 'TELEGRAM',
          markSubscribed: false,
          externalSubscribedAt: new Date(),
        });
        return;
      }

      const bot = this.bots.get(channel.id);
      const tgPhotoUrl = bot ? await this.fetchProfilePhotoFileId(bot, tgUser.id) : undefined;

      const client = await this.clientsService.findOrCreate({
        projectId: channel.projectId,
        tgUserId: String(tgUser.id),
        tgUsername: tgUser.username,
        tgFirstName: tgUser.first_name,
        tgLastName: tgUser.last_name,
        tgLanguage: tgUser.language_code,
        tgIsPremium: tgUser.is_premium ?? false,
        tgPhotoUrl,
        channelType: 'TELEGRAM',
        subscribedAt: new Date(),
      });

      await this.trackingService.recordEvent(channel.projectId, {
        eventName: 'Subscribe',
        clientId: client.id,
        tgUserId: String(tgUser.id),
        source: 'SERVER',
      });
      return;
    }

    if (wasMember && !isMember) {
      await this.clientsService.markUnsubscribed(String(tgUser.id), channel.projectId);
      await this.triggerScenario(String(tgUser.id), channel, 'UNSUBSCRIBE');
    }
  }

  // Ловит любое текстовое сообщение, не перехваченное bot.command('start'/'purchase') выше
  // (см. регистрацию в initialize()). "/xxx" — пользовательская команда-сценарий, всё
  // остальное — дефолтное сообщение. Без анти-спам лимита (согласовано с пользователем
  // 2026-07-03) — бот отвечает на каждое нераспознанное сообщение, включая повторы подряд.
  private async handleIncomingText(ctx: Context, channel: Channel): Promise<void> {
    const text = ctx.message?.text?.trim();
    const tgUserId = ctx.from?.id;
    if (!text || !tgUserId) return;

    // Диалог — запрос пользователя 2026-07-04. Не блокирует ответ сценария ниже, но и не
    // должен уронить его при сбое — best-effort, как и остальной учёт метаданных в этом файле.
    try {
      await this.clientsService.recordInboundMessage(channel.projectId, {
        tgUserId: String(tgUserId),
        tgUsername: ctx.from?.username,
        tgFirstName: ctx.from?.first_name,
        tgLastName: ctx.from?.last_name,
        // Бот-канал всегда имеет отдельное реальное событие подписки (join-request/
        // chat_member) — если Client тут ещё не существовал, значит человек написал боту
        // напрямую, минуя нашу воронку.
        treatAsSubscriber: false,
        viaBot: true,
        countBotAsDialogue: channel.tgMode === 'BOT_DIRECT',
      });
    } catch (error) {
      this.logger.warn(`recordInboundMessage failed for channel ${channel.id}: ${(error as Error).message}`);
    }

    if (text.startsWith('/')) {
      // "/price@botname args" → "price" — отбрасываем @botname (Telegram добавляет его в
      // группах) и аргументы после команды.
      const command = text.slice(1).split(/[\s@]/)[0].toLowerCase();
      if (command) await this.triggerScenario(String(tgUserId), channel, 'COMMAND', command);
      return;
    }

    await this.triggerScenario(String(tgUserId), channel, 'DEFAULT');
  }

  // Находит активный сценарий по (channel, triggerType, command) и отправляет его — сразу
  // либо отложенной джобой (BotScenario.delaySeconds), тот же принцип, что и
  // approveJoinRequestMaybeDelayed. Публичный — вызывается и отсюда (message:text/
  // chat_member), и из ChannelsService.triggerScenario (канало-агностичная обёртка,
  // используется из PurchasesService для FIRST_DEPOSIT/REPEAT_DEPOSIT).
  async triggerScenario(channelUserId: string, channel: Channel, triggerType: BotScenarioTrigger, command?: string): Promise<void> {
    const scenario = await this.prisma.botScenario.findFirst({
      where: { channelId: channel.id, triggerType, command: command ?? '', isActive: true, deletedAt: null },
    });
    if (!scenario) return; // сценарий просто не настроен — в т.ч. нормальный случай для DEFAULT

    if (scenario.delaySeconds > 0) {
      await this.scenarioQueue.add(
        'send-scenario-message',
        { channelId: channel.id, tgUserId: channelUserId, scenarioId: scenario.id },
        { delay: scenario.delaySeconds * 1000, removeOnComplete: true, removeOnFail: 50 },
      );
      return;
    }

    await this.sendScenarioMessage(channelUserId, scenario, channel);
  }

  // Собирает SendMessageOptions из сценария (та же форма, что и у приветствия — текст/медиа/
  // кнопки) и отправляет. Публичный — вызывается и из triggerScenario (без задержки), и из
  // BotScenarioMessageProcessor (с задержкой).
  async sendScenarioMessage(channelUserId: string, scenario: BotScenario, channel: Channel): Promise<void> {
    const buttons = (scenario.buttons as Array<{ text: string; url: string }> | null) || undefined;
    const mediaUrl = scenario.mediaKey
      ? `${this.config.get<string>('API_URL')}/api/v1/channels/${channel.id}/scenarios/${scenario.id}/media`
      : undefined;

    await this.sendMessage(
      channelUserId,
      {
        text: scenario.messageText || '',
        mediaUrl,
        mediaType: (scenario.mediaType?.toLowerCase() as SendMessageOptions['mediaType']) || undefined,
        buttons,
      },
      channel,
    );
  }

  // Собирает SendMessageOptions из настроек канала (текст/медиа/кнопки) и отправляет —
  // вынесено из handleJoinRequest отдельным методом, т.к. используется только здесь (одно
  // приветственное сообщение на одобрение заявки, см. описание фичи в 15_PHASES.md). Медиа
  // отдаётся Telegram-у не байтами, а публичной ссылкой на самих себя
  // (GET /channels/:id/welcome-media, см. ChannelsService.streamWelcomeMedia) — тот же приём,
  // что и mediaUrl у Push-рассылок, только источник — наш собственный API, а не сторонний хостинг.
  // Публичный — вызывается и отсюда (handleJoinRequest, без задержки), и из
  // JoinRequestApprovalProcessor (с задержкой, Channel.tgJoinDelaySeconds).
  async sendWelcomeMessage(channelUserId: string, channel: Channel): Promise<void> {
    if (!channel.tgWelcomeMessage && !channel.tgWelcomeMediaKey) return;

    const buttons = (channel.tgWelcomeButtons as Array<{ text: string; url: string }> | null) || undefined;
    const mediaUrl = channel.tgWelcomeMediaKey
      ? `${this.config.get<string>('API_URL')}/api/v1/channels/${channel.id}/welcome-media`
      : undefined;

    await this.sendMessage(
      channelUserId,
      {
        text: channel.tgWelcomeMessage || '',
        mediaUrl,
        mediaType: (channel.tgWelcomeMediaType?.toLowerCase() as SendMessageOptions['mediaType']) || undefined,
        buttons,
      },
      channel,
    );
  }

  async sendMessage(channelUserId: string, options: SendMessageOptions, channel: Channel): Promise<SendMessageResult> {
    const bot = this.bots.get(channel.id);
    if (!bot) {
      this.logger.warn(`sendMessage: no bot instance for channel ${channel.id}`);
      return { success: false, error: 'Бот не инициализирован для этого канала' };
    }

    try {
      const reply_markup = options.buttons
        ? { inline_keyboard: [options.buttons.map((b) => ({ text: b.text, url: b.url }))] }
        : undefined;
      const parse_mode = options.parseMode || 'HTML';

      if (options.mediaGroup && options.mediaGroup.length > 1) {
        // Альбом (sendMediaGroup) — Bot API ограничения, отличные от одиночной отправки:
        // подпись можно повесить на любой элемент, кладём на первый (так альбом с текстом
        // выглядит для получателя, как единое сообщение с подписью снизу); reply_markup
        // здесь вообще не поддерживается API — если есть кнопки, шлём их отдельным
        // сообщением следом за альбомом (тот же приём, что и текст у video_note выше).
        // InputFile вместо URL-ссылки на каждый элемент — баг-репорт пользователя 2026-07-18:
        // реальные фото с камеры (6+MB) стабильно валили sendMediaGroup ("WEBPAGE_CURL_FAILED"/
        // "WEBPAGE_MEDIA_EMPTY") — у fetch-по-ссылке подсистемы Telegram есть свой лимит
        // размера/поведения, заметно строже нашего собственного (см. также одиночный photo/
        // video ниже — тот же класс проблемы, тот же фикс).
        const mediaFiles = await Promise.all(options.mediaGroup.map((item) => this.fetchAsInputFile(item.url)));
        await bot.api.sendMediaGroup(
          channelUserId,
          options.mediaGroup.map((item, i) => ({
            type: item.type,
            media: mediaFiles[i],
            ...(i === 0 && options.text ? { caption: options.text, parse_mode } : {}),
          })),
        );
        if (reply_markup) {
          // Отдельный try/catch — если это follow-up сообщение упадёт, альбом (уже
          // реально доставленный) не должен задним числом считаться неотправленным
          // (тот же баг 2026-07-17, что и у video_note ниже: одно исключение в общем
          // try/catch перечёркивало успех уже случившейся отправки).
          try {
            await bot.api.sendMessage(channelUserId, '​', { reply_markup });
          } catch (buttonsError) {
            this.logger.warn(`album follow-up buttons failed for channel ${channel.id}: ${(buttonsError as Error).message}`);
          }
        }
      } else if (options.mediaUrl && options.mediaType) {
        switch (options.mediaType) {
          case 'photo': {
            // InputFile вместо URL — та же причина, что и у альбома выше: реальные фото с
            // камеры (6+MB) стабильно не проходили через fetch-по-ссылке Telegram
            // ("failed to get HTTP URL content" / "wrong type of the web page content" —
            // оба это внутренний webpage-фетчер Telegram, у него более жёсткий лимит, чем
            // у нашего собственного 50MB), а через реальную загрузку байт — проходят.
            const file = await this.fetchAsInputFile(options.mediaUrl);
            await bot.api.sendPhoto(channelUserId, file, { caption: options.text, parse_mode, reply_markup });
            break;
          }
          case 'video': {
            const file = await this.fetchAsInputFile(options.mediaUrl);
            await bot.api.sendVideo(channelUserId, file, { caption: options.text, parse_mode, reply_markup });
            break;
          }
          case 'voice': {
            const file = await this.fetchAsInputFile(options.mediaUrl);
            await bot.api.sendVoice(channelUserId, file, { caption: options.text, parse_mode, reply_markup });
            break;
          }
          case 'document': {
            const file = await this.fetchAsInputFile(options.mediaUrl);
            await bot.api.sendDocument(channelUserId, file, { caption: options.text, parse_mode, reply_markup });
            break;
          }
          case 'video_note': {
            // sendVideoNote не принимает caption вообще (ограничение Bot API — "кружки" не
            // могут иметь подпись) — кнопки уходят вместе с кружком, а текст, если задан,
            // отдельным сообщением следом, иначе он был бы молча потерян.
            // new InputFile(new URL(...)) — принудительная загрузка байт, а не передача
            // ссылки: sendVideoNote не поддерживает HTTP-ссылку в video_note (задокументированное
            // ограничение Bot API).
            // ОТКАТ 2026-07-17: пробовали передавать length/duration явно (вычислив самим
            // ffprobe), решая "видео обрезалось, но всё равно не кружок" — вместо этого
            // получили НОВЫЙ баг: "400 Bad Request: wrong video note length" у реального
            // клиента (видео было честно 1080x1080 по ffprobe). Явно переданное значение,
            // видимо, не всегда совпадает с тем, что сам Telegram вычисляет/ожидает после
            // приёма файла — хуже, чем просто дать Telegram определить самому. Урок:
            // добавление необязательного API-параметра "на всякий случай" без воспроизводимого
            // подтверждения, что он решает проблему, может сломать то, что уже работало.
            let videoNoteFile: InputFile;
            try {
              const probed = await this.videoProcessing.fetchAndProbe(options.mediaUrl);
              videoNoteFile = new InputFile(probed.buffer);
            } catch (probeError) {
              this.logger.warn(`video_note fetchAndProbe failed for channel ${channel.id}, falling back to direct URL fetch: ${(probeError as Error).message}`);
              videoNoteFile = new InputFile(new URL(options.mediaUrl));
            }
            await bot.api.sendVideoNote(channelUserId, videoNoteFile, { reply_markup });
            if (options.text) {
              // Отдельный try/catch — невалидный HTML в тексте (несбалансированные теги)
              // не должен задним числом считать уже доставленный кружок неотправленным
              // (тот же баг: одно исключение в общем try/catch перечёркивало успех).
              try {
                await bot.api.sendMessage(channelUserId, options.text, { parse_mode });
              } catch (textError) {
                this.logger.warn(`video_note follow-up text failed for channel ${channel.id}: ${(textError as Error).message}`);
              }
            }
            break;
          }
        }
      } else {
        await bot.api.sendMessage(channelUserId, options.text, { parse_mode, reply_markup });
      }

      return { success: true };
    } catch (error) {
      // 403 Forbidden — раньше ЛЮБОЙ 403 трактовался как "пользователь заблокировал бота" и
      // молча (!) звал markBotBlocked без единой строки в логах — баг-репорт пользователя
      // 2026-07-18: клиент помечен заблокировавшим бота, хотя реально не блокировал, и
      // проверить это по логам оказалось невозможно (эта ветка никогда ничего не логировала).
      // У 403 в Bot API есть и другие причины (аккаунт удалён — "user is deactivated",
      // и т.п.), не только реальная блокировка — Telegram всегда даёт точный текст в
      // description, сверяемся с ним, а не считаем любой 403 блокировкой вслепую.
      if (error instanceof GrammyError && error.error_code === 403) {
        const isRealBlock = /blocked/i.test(error.description);
        this.logger.warn(`sendMessage 403 for channel ${channel.id}, user ${channelUserId}: "${error.description}" (isRealBlock=${isRealBlock})`);
        if (isRealBlock) {
          await this.clientsService.markBotBlocked(channelUserId, channel.projectId);
          return { success: false, error: 'Пользователь заблокировал бота' };
        }
        return { success: false, error: error.description };
      }
      const message = (error as Error).message;
      this.logger.error(`sendMessage failed for channel ${channel.id}: ${message}`);
      return { success: false, error: message };
    }
  }

  // Скачивает файл сами и оборачивает в InputFile — принудительная реальная загрузка байт
  // вместо передачи Telegram голой HTTP-ссылки на самостоятельную закачку. Используется для
  // ЛЮБОГО медиа в пушах/сценариях/приветствиях (баг-репорт пользователя 2026-07-18: реальные
  // фото с камеры 6+MB стабильно не проходили через fetch-по-ссылке — Telegram отвечал то
  // "failed to get HTTP URL content", то "wrong type of the web page content", то
  // "WEBPAGE_CURL_FAILED"/"WEBPAGE_MEDIA_EMPTY" в альбоме — разные формулировки одной и той
  // же внутренней проблемы: собственный webpage-фетчер Telegram у него заметно капризнее и
  // строже по лимитам, чем наш собственный 50MB). При ошибке фетча пробрасываем исходную
  // ошибку — пусть внешний catch классифицирует как обычную неудачную отправку.
  private async fetchAsInputFile(url: string): Promise<InputFile> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetchAsInputFile: ${res.status} ${res.statusText} for ${url}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return new InputFile(buffer);
  }

  async getUserStatus(_channelUserId: string): Promise<UserStatus> {
    // Полноценная проверка через getChatMember требует chatId конкретного канала —
    // версия "по умолчанию доступен" достаточна для текущей фазы; уточняется в 1.6/2.x.
    return { isReachable: true, isSubscribed: true };
  }

  // Вызывается из WebhooksController
  async handleWebhook(channelId: string, update: object): Promise<void> {
    const bot = this.bots.get(channelId);
    if (!bot) {
      this.logger.warn(`handleWebhook: no bot instance for channel ${channelId}`);
      return;
    }
    await bot.handleUpdate(update as Parameters<Bot['handleUpdate']>[0]);
  }
}
