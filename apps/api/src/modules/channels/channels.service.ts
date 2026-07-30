import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Response } from 'express';
import { BotScenarioTrigger, Channel, ChannelType, Client } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelProvider, SendMessageOptions, SendMessageResult } from './providers/channel.provider.interface';
import { TelegramProvider } from './providers/telegram.provider';
import { TelegramPersonalService } from './providers/telegram-personal.service';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { InstagramProvider } from './providers/instagram.provider';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { TestMessageDto } from './dto/test-message.dto';
import { renderMessagePlaceholders } from '../../common/message-placeholders.util';

@Injectable()
export class ChannelsService implements OnModuleInit {
  private readonly logger = new Logger(ChannelsService.name);

  // TELEGRAM + WHATSAPP + INSTAGRAM реализованы (шаги 1.5/2.1/2.6 из 15_PHASES.md).
  // Viber/Email — добавляются той же картой без правок бизнес-логики.
  private providers: Partial<Record<ChannelType, ChannelProvider>>;

  constructor(
    private prisma: PrismaService,
    private telegramProvider: TelegramProvider,
    private telegramPersonalService: TelegramPersonalService,
    private whatsAppProvider: WhatsAppProvider,
    private instagramProvider: InstagramProvider,
  ) {
    this.providers = { TELEGRAM: this.telegramProvider, WHATSAPP: this.whatsAppProvider, INSTAGRAM: this.instagramProvider };
  }

  // При старте процесса bots-карта провайдера (и Basic Auth у WhatsApp) пустая (in-memory) —
  // без регидратации все активные каналы перестали бы получать вебхуки после деплоя/рестарта.
  // Instagram ничего не хранит в памяти (нет постоянного соединения как у бота), но initialize()
  // всё равно стоит перепрогнать — Meta может сбросить подписку Page на вебхуки.
  async onModuleInit() {
    const channels = await this.prisma.channel.findMany({
      where: { type: { in: ['TELEGRAM', 'WHATSAPP', 'INSTAGRAM'] }, isActive: true },
    });

    for (const channel of channels) {
      try {
        await this.getProvider(channel.type).initialize(channel);
      } catch (error) {
        this.logger.warn(`Failed to rehydrate ${channel.type} channel ${channel.id}: ${(error as Error).message}`);
      }
    }

    // Личный аккаунт (MTProto, запрос пользователя 2026-07-04) — отдельная реконнект-петля, не
    // идёт через getProvider()/ChannelProvider.initialize() (это не Bot API, initialize() для
    // PERSONAL_DM осознанно ничего не делает, см. TelegramProvider). Живое соединение тоже
    // in-memory, теряется при рестарте, требует своей регидратации. НЕ фильтруем по tgMode
    // (запрос пользователя 2026-07-17: "даже для каналов должна быть возможность привязки
    // личного аккаунта") — личный аккаунт для отслеживания диалогов может быть привязан к
    // каналу любого режима (бот продолжает вести подписчиков как обычно, личный аккаунт —
    // независимо, только для диалогов), не только к чистому PERSONAL_DM. Единственное реальное
    // условие — сохранённая сессия (tgSessionEncrypted).
    const personalChannels = await this.prisma.channel.findMany({
      where: { type: 'TELEGRAM', isActive: true, tgSessionEncrypted: { not: null } },
    });
    for (const channel of personalChannels) {
      try {
        await this.telegramPersonalService.startListening(channel);
      } catch (error) {
        this.logger.warn(`Failed to rehydrate personal Telegram session for channel ${channel.id}: ${(error as Error).message}`);
      }
    }
  }

  getProvider(channelType: ChannelType): ChannelProvider {
    const provider = this.providers[channelType];
    if (!provider) throw new Error(`Provider for ${channelType} not implemented yet`);
    return provider;
  }

  async sendMessage(client: Client, options: SendMessageOptions): Promise<SendMessageResult> {
    const channelUserId = this.getChannelUserId(client);
    if (!channelUserId || !client.channelType) return { success: false, error: 'У клиента нет ID канала' };

    // 1:1 с 2026-07-02 — у проекта максимум один канал, дизамбигуация "последний
    // подключённый канал этого типа" больше не нужна. channel.type === client.channelType —
    // дешёвый sanity-check против рассинхронизации client.channelType, а не доверие вслепую.
    const channel = await this.prisma.channel.findFirst({
      where: { projectId: client.projectId, isActive: true },
    });
    if (!channel || channel.type !== client.channelType) {
      return { success: false, error: 'Канал проекта не найден или неактивен' };
    }

    const provider = this.getProvider(client.channelType);
    return provider.sendMessage(channelUserId, this.applyPlaceholders(options, client), channel);
  }

  // Персонализация {first_name}/{last_name}/{full_name}/{username} (запрос пользователя
  // 2026-07-27) — единая точка для рассылок (PushesProcessor) и автоворонок
  // (AutomationEngineService), оба зовут этот sendMessage с уже известным Client. У сценариев
  // бота (BotScenarioEngineService) свой отдельный вызов sendMessage — Client там не всегда
  // есть (холодные контакты), см. bot-scenario-engine.service.ts.
  private applyPlaceholders(options: SendMessageOptions, client: Client): SendMessageOptions {
    // WhatsApp/Instagram не дают отдельных first/last name полей (только общее имя профиля/
    // юзернейм) — берём то, что реально есть у клиента, независимо от channelType.
    const source = {
      firstName: client.tgFirstName || client.waName,
      lastName: client.tgLastName,
      username: client.tgUsername || client.igUsername,
    };
    return {
      ...options,
      text: renderMessagePlaceholders(options.text, source),
      buttons: options.buttons?.map((b) => ({ ...b, text: renderMessagePlaceholders(b.text, source) })),
    };
  }

  // Канало-агностичная обёртка над provider.triggerScenario (см. ChannelProvider) — тот же
  // паттерн резолвинга channelUserId/channel, что и sendMessage выше. Вызывается из
  // PurchasesService.create() после успешной регистрации депозита (FIRST_DEPOSIT/
  // REPEAT_DEPOSIT) — не напрямую из TelegramProvider, чтобы clients-модуль не тянул
  // channels-провайдеры напрямую (см. комментарий в PurchasesService).
  async triggerScenario(client: Client, triggerType: BotScenarioTrigger, command?: string): Promise<void> {
    const channelUserId = this.getChannelUserId(client);
    if (!channelUserId || !client.channelType) return;

    const channel = await this.prisma.channel.findFirst({ where: { projectId: client.projectId, isActive: true } });
    if (!channel || channel.type !== client.channelType) return;

    const provider = this.getProvider(client.channelType);
    await provider.triggerScenario?.(channelUserId, channel, triggerType, command);
  }

  private getChannelUserId(client: Client): string | null {
    switch (client.channelType) {
      case 'TELEGRAM':
        return client.tgUserId;
      case 'WHATSAPP':
        return client.waPhone;
      case 'INSTAGRAM':
        return client.igUserId;
      default:
        return null;
    }
  }

  // Публичный (не private) — под 1:1 канал создаётся вместе с проектом внутри
  // ProjectsService.create() (в одной транзакции с Project), а инициализацию (внешний
  // вызов к Telegram/WhatsApp/Instagram, не может быть частью DB-транзакции) ProjectsService
  // запускает отдельно сразу после коммита, вызывая этот метод напрямую — отдельного
  // публичного `POST /channels` для создания канала больше нет (см. ChannelsController).
  //
  // Используется и при создании, и при повторной попытке (reactivate) — не должно
  // блокировать сохранение конфигурации канала при невалидном токене/боте без прав
  // администратора/недоступном публичном HTTPS URL в dev. lastError — реальная причина
  // для UI, без него пользователь видел только "Отключён" без единой подсказки, почему.
  async tryInitialize(channel: Channel): Promise<Channel> {
    const provider = this.getProvider(channel.type);
    try {
      await provider.initialize(channel);
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`initialize() failed for channel ${channel.id}: ${message}`);
      return this.prisma.channel.update({ where: { id: channel.id }, data: { isActive: false, lastError: message } });
    }

    return this.prisma.channel.update({ where: { id: channel.id }, data: { isActive: true, lastError: null } });
  }

  async reactivate(id: string, companyId: string): Promise<Channel> {
    const channel = await this.findOne(id, companyId);
    return this.tryInitialize(channel);
  }

  async findOne(id: string, companyId: string): Promise<Channel> {
    const channel = await this.prisma.channel.findFirst({
      where: { id, project: { companyId } },
    });
    if (!channel) throw new NotFoundException('Канал не найден');
    return channel;
  }

  // Сами скачиваем файл у Telegram и стримим байты дальше — getFile отдаёт file_path, по
  // которому скачивание идёт через URL вида api.telegram.org/file/bot<TOKEN>/<path> (секретный
  // токен в самом пути), поэтому отдавать эту ссылку клиенту напрямую нельзя.
  async streamAvatar(id: string, companyId: string, res: Response): Promise<void> {
    const channel = await this.findOne(id, companyId);
    const result = await this.fetchTelegramAvatarBuffer(channel);
    if (!result) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(result.buffer);
  }

  // Вынесено из streamAvatar, чтобы переиспользовать в LandingsService.streamAvatar —
  // дефолтная аватарка лендинга ("изначально как в канале", запрос пользователя 2026-07-04),
  // если у самого лендинга своя не загружена. Публичный метод, не привязан к Response —
  // вызывающий сам решает, публично отдавать байты или только авторизованным.
  async fetchTelegramAvatarBuffer(channel: Channel): Promise<{ buffer: Buffer; contentType: string } | null> {
    if (!channel.tgAvatarFileId || !channel.tgBotToken) return null;
    return this.fetchTelegramFileBuffer(channel.id, channel.tgBotToken, channel.tgAvatarFileId);
  }

  // Обобщённое ядро — тот же двухшаговый Telegram-флоу (getFile → скачать байты), но принимает
  // произвольный file_id, а не только фото канала. Переиспользуется ClientsService для аватара
  // самого клиента (запрос пользователя 2026-07-04, "собирай больше данных о клиентах") — там
  // нет целого Channel-объекта под рукой, только channelId/botToken/fileId по отдельности.
  async fetchTelegramFileBuffer(channelId: string, botToken: string, fileId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    try {
      const bot = this.telegramProvider.getBot(channelId);
      const file = bot
        ? await bot.api.getFile(fileId)
        : await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)
            .then((r) => r.json())
            .then((j) => j.result);

      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok || !fileResponse.body) return null;

      return {
        buffer: Buffer.from(await fileResponse.arrayBuffer()),
        contentType: fileResponse.headers.get('content-type') || 'image/jpeg',
      };
    } catch (error) {
      this.logger.warn(`fetchTelegramFileBuffer failed for channel ${channelId}: ${(error as Error).message}`);
      return null;
    }
  }

  // Переинициализация после update обязательна: смена tgMode/tgChannelUsername/
  // tgPersonalUsername меняет, что должен делать provider.initialize() (например,
  // создать invite-ссылку для нового PRIVATE_CHANNEL_REQUEST) — без повторного вызова
  // изменение осело бы только в БД, реального эффекта на бота/вебхук не было бы.
  async update(id: string, companyId: string, dto: UpdateChannelDto): Promise<Channel> {
    await this.findOne(id, companyId);
    const updated = await this.prisma.channel.update({ where: { id }, data: dto });
    return this.tryInitialize(updated);
  }

  // Без hard delete и без отдельной deletedAt-колонки на Channel (которой нет в схеме):
  // деактивация — практический эквивалент удаления для канала.
  async deactivate(id: string, companyId: string): Promise<Channel> {
    const channel = await this.findOne(id, companyId);

    if (channel.type === 'TELEGRAM') {
      const bot = this.telegramProvider.getBot(channel.id);
      if (bot) {
        try {
          await bot.api.deleteWebhook();
        } catch (error) {
          this.logger.warn(`deleteWebhook failed for channel ${channel.id}: ${(error as Error).message}`);
        }
      }
    }

    return this.prisma.channel.update({ where: { id }, data: { isActive: false } });
  }

  async testMessage(id: string, companyId: string, dto: TestMessageDto): Promise<{ sent: boolean; error?: string }> {
    const channel = await this.findOne(id, companyId);
    const provider = this.getProvider(channel.type);
    const result = await provider.sendMessage(
      dto.channelUserId,
      { text: dto.text || '✅ Тестовое сообщение от TrafficCRM' },
      channel,
    );
    return { sent: result.success, error: result.error };
  }

  async checkHealth(id: string, companyId: string): Promise<{ healthy: boolean; message?: string }> {
    const channel = await this.findOne(id, companyId);
    return this.checkChannelHealth(channel);
  }

  private async checkChannelHealth(channel: Channel): Promise<{ healthy: boolean; message?: string }> {
    if (channel.type === 'TELEGRAM') return this.checkTelegramHealth(channel);
    // WhatsApp/прочее: 360dialog не даёт дешёвого "ping" — статус isActive (выставляется
    // false при ошибке initialize()/отсутствии токена) достаточен для текущей фазы.
    return { healthy: channel.isActive };
  }

  private async checkTelegramHealth(channel: Channel): Promise<{ healthy: boolean; message?: string }> {
    // PERSONAL_DM — не бот, нет вебхука/инстанса для проверки вообще (см.
    // TelegramProvider.initialize()); "здоровье" этого режима — просто наличие username.
    if (channel.tgMode === 'PERSONAL_DM') {
      return { healthy: !!channel.tgPersonalUsername, message: channel.tgPersonalUsername ? undefined : 'Не указан username' };
    }

    const bot = this.telegramProvider.getBot(channel.id);
    if (!bot) return { healthy: false, message: 'Бот не инициализирован (см. ошибку при создании канала)' };

    try {
      const me = await bot.api.getMe();

      if (channel.tgChannelId) {
        const member = await bot.api.getChatMember(channel.tgChannelId, me.id);
        if (!['administrator', 'creator'].includes(member.status)) {
          return { healthy: false, message: 'Бот удалён из канала!' };
        }
      }

      return { healthy: true };
    } catch (error) {
      return { healthy: false, message: `Ошибка канала: ${(error as Error).message}` };
    }
  }

  // Каждые 15 минут — независимая от событий проверка живости ботов,
  // дублирует event-driven отключение в TelegramProvider.handleMemberUpdate
  // (на случай если webhook-обновление о выходе бота было пропущено).
  @Cron('*/15 * * * *')
  async checkAllChannelsHealth() {
    const channels = await this.prisma.channel.findMany({ where: { isActive: true } });

    for (const channel of channels) {
      const result = await this.checkChannelHealth(channel);
      if (!result.healthy) {
        this.logger.warn(`Channel ${channel.id} unhealthy: ${result.message}`);
        await this.prisma.channel.update({
          where: { id: channel.id },
          data: { isActive: false, lastError: result.message || 'Канал недоступен' },
        });
      }
    }
  }

}
