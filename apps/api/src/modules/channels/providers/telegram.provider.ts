import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '@prisma/client';
import { Bot, Context, GrammyError } from 'grammy';
import { ClientLimitReachedException, ClientsService } from '../../clients/clients.service';
import { PurchasesService } from '../../clients/purchases.service';
import { TrackingService } from '../../tracking/tracking.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { ChannelProvider, SendMessageOptions, UserStatus } from './channel.provider.interface';

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

    bot.on('chat_join_request', async (ctx) => {
      await this.handleJoinRequest(ctx, channel);
    });

    bot.command('start', async (ctx) => {
      await this.handleStart(ctx, channel);
    });

    bot.command('purchase', async (ctx) => {
      await this.handlePurchaseCommand(ctx, channel);
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
    // tgBotUsername остаётся null навсегда и deep-link на лендинге (шаг 1.9,
    // https://t.me//* {{BOT_USERNAME}} */?start=...) никогда не будет рабочим.
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
    if (mode === 'PRIVATE_CHANNEL_REQUEST' && channel.tgChannelId && !channel.tgInviteLink) {
      try {
        const invite = await bot.api.createChatInviteLink(channel.tgChannelId, {
          name: 'TrafficCRM landing',
          creates_join_request: true,
        });
        await this.prisma.channel.update({ where: { id: channel.id }, data: { tgInviteLink: invite.invite_link } });
        channel.tgInviteLink = invite.invite_link;
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
    // канал (без approval) никогда бы не дошли до бота.
    await bot.api.setWebhook(webhookUrl, {
      allowed_updates: ['message', 'chat_join_request', 'my_chat_member', 'chat_member'],
    });
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

  private async handleJoinRequest(ctx: Context, channel: Channel) {
    const tgUser = ctx.chatJoinRequest?.from;
    if (!tgUser) return;

    try {
      const client = await this.clientsService.findOrCreate({
        projectId: channel.projectId,
        tgUserId: String(tgUser.id),
        tgUsername: tgUser.username,
        tgFirstName: tgUser.first_name,
        tgLastName: tgUser.last_name,
        tgLanguage: tgUser.language_code,
        channelType: 'TELEGRAM',
        subscribedAt: new Date(),
      });

      await ctx.api.approveChatJoinRequest(ctx.chatJoinRequest!.chat.id, tgUser.id);

      if (channel.tgWelcomeMessage) {
        await this.sendMessage(String(tgUser.id), { text: channel.tgWelcomeMessage }, channel);
      }

      // recordEvent пишет в TrackingEvent и ставит задачу в очередь tracking-events
      // на отправку в FB/TikTok (TrackingProcessor, шаг 1.7) — clientId передан явно,
      // чтобы TrackingService не делал повторный поиск по tgUserId.
      await this.trackingService.recordEvent(channel.projectId, {
        eventName: 'Subscribe',
        clientId: client.id,
        tgUserId: String(tgUser.id),
        source: 'SERVER',
      });
    } catch (error) {
      if (error instanceof ClientLimitReachedException) {
        await ctx.api.declineChatJoinRequest(ctx.chatJoinRequest!.chat.id, tgUser.id);
        return;
      }
      this.logger.error(`Error handling join request for channel ${channel.id}: ${(error as Error).message}`);
    }
  }

  private async handleStart(ctx: Context, channel: Channel) {
    const startParam = ctx.match as string;

    if (startParam) {
      const trackingDataRaw = await this.redis.get(`start:${startParam}`);
      if (trackingDataRaw) {
        const { fbclid, ttclid, utmSource, utmCampaign } = JSON.parse(trackingDataRaw);

        await this.clientsService.updateTracking(String(ctx.from?.id), channel.projectId, {
          fbclid,
          ttclid,
          utmSource,
          utmCampaign,
        });

        // Одноразовый код — удаляется после использования
        await this.redis.del(`start:${startParam}`);
      }
    }

    // PRIVATE_CHANNEL_REQUEST: лендинг ведёт сюда (в бота), а не прямо на invite-ссылку
    // канала, специально — у ссылок Telegram-каналов нет query-параметров, без захода
    // через бота атрибуция (fbclid/utm выше) терялась бы полностью. Дальше бот сам
    // вручает invite-ссылку — клик по ней даёт "Request to Join", который дальше
    // одобряет handleJoinRequest.
    if (channel.tgMode === 'PRIVATE_CHANNEL_REQUEST' && channel.tgInviteLink) {
      await ctx.reply(channel.tgWelcomeMessage || 'Чтобы вступить в канал, подайте заявку по кнопке ниже:', {
        reply_markup: { inline_keyboard: [[{ text: '📩 Подать заявку на вступление', url: channel.tgInviteLink }]] },
      });
    }
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

  private async handleMemberUpdate(ctx: Context, channel: Channel) {
    // my_chat_member — статус самого БОТА в чате (не обычного участника).
    // Если бота кикнули/он покинул канал — деактивировать канал, чтобы health-check
    // и UI ("активен/ошибка" в 12_FRONTEND_PAGES.md) сразу отражали реальное состояние,
    // не дожидаясь следующего 15-минутного cron-прогона.
    const newStatus = ctx.myChatMember?.new_chat_member.status;
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
      const client = await this.clientsService.findOrCreate({
        projectId: channel.projectId,
        tgUserId: String(tgUser.id),
        tgUsername: tgUser.username,
        tgFirstName: tgUser.first_name,
        tgLastName: tgUser.last_name,
        tgLanguage: tgUser.language_code,
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
    }
  }

  async sendMessage(channelUserId: string, options: SendMessageOptions, channel: Channel): Promise<boolean> {
    const bot = this.bots.get(channel.id);
    if (!bot) {
      this.logger.warn(`sendMessage: no bot instance for channel ${channel.id}`);
      return false;
    }

    try {
      const reply_markup = options.buttons
        ? { inline_keyboard: [options.buttons.map((b) => ({ text: b.text, url: b.url }))] }
        : undefined;

      if (options.mediaUrl && options.mediaType === 'photo') {
        await bot.api.sendPhoto(channelUserId, options.mediaUrl, {
          caption: options.text,
          parse_mode: options.parseMode || 'HTML',
          reply_markup,
        });
      } else {
        await bot.api.sendMessage(channelUserId, options.text, {
          parse_mode: options.parseMode || 'HTML',
          reply_markup,
        });
      }

      return true;
    } catch (error) {
      // 403 Forbidden — пользователь заблокировал бота
      if (error instanceof GrammyError && error.error_code === 403) {
        await this.clientsService.markBotBlocked(channelUserId, channel.projectId);
      } else {
        this.logger.error(`sendMessage failed for channel ${channel.id}: ${(error as Error).message}`);
      }
      return false;
    }
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
