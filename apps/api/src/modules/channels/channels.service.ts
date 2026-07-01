import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Response } from 'express';
import { Channel, ChannelType, Client } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelProvider, SendMessageOptions } from './providers/channel.provider.interface';
import { TelegramProvider } from './providers/telegram.provider';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { InstagramProvider } from './providers/instagram.provider';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { TestMessageDto } from './dto/test-message.dto';

@Injectable()
export class ChannelsService implements OnModuleInit {
  private readonly logger = new Logger(ChannelsService.name);

  // TELEGRAM + WHATSAPP + INSTAGRAM реализованы (шаги 1.5/2.1/2.6 из 15_PHASES.md).
  // Viber/Email — добавляются той же картой без правок бизнес-логики.
  private providers: Partial<Record<ChannelType, ChannelProvider>>;

  constructor(
    private prisma: PrismaService,
    private telegramProvider: TelegramProvider,
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
  }

  getProvider(channelType: ChannelType): ChannelProvider {
    const provider = this.providers[channelType];
    if (!provider) throw new Error(`Provider for ${channelType} not implemented yet`);
    return provider;
  }

  async sendMessage(client: Client, options: SendMessageOptions): Promise<boolean> {
    const channelUserId = this.getChannelUserId(client);
    if (!channelUserId || !client.channelType) return false;

    const channel = await this.prisma.channel.findFirst({
      where: { projectId: client.projectId, type: client.channelType, isActive: true },
      orderBy: { createdAt: 'desc' }, // последний подключённый канал этого типа — см. ту же логику в LandingRendererService
    });
    if (!channel) return false;

    const provider = this.getProvider(client.channelType);
    return provider.sendMessage(channelUserId, options, channel);
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

  async create(companyId: string, dto: CreateChannelDto): Promise<Channel> {
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, companyId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Проект не найден');

    const channel = await this.prisma.channel.create({ data: { ...dto } });
    return this.tryInitialize(channel);
  }

  // Используется и при создании, и при повторной попытке (reactivate) — не должно
  // блокировать сохранение конфигурации канала при невалидном токене/боте без прав
  // администратора/недоступном публичном HTTPS URL в dev. lastError — реальная причина
  // для UI, без него пользователь видел только "Отключён" без единой подсказки, почему.
  private async tryInitialize(channel: Channel): Promise<Channel> {
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
    if (!channel.tgAvatarFileId || !channel.tgBotToken) {
      res.status(404).end();
      return;
    }

    try {
      const bot = this.telegramProvider.getBot(channel.id);
      const file = bot
        ? await bot.api.getFile(channel.tgAvatarFileId)
        : await fetch(`https://api.telegram.org/bot${channel.tgBotToken}/getFile?file_id=${channel.tgAvatarFileId}`)
            .then((r) => r.json())
            .then((j) => j.result);

      const fileUrl = `https://api.telegram.org/file/bot${channel.tgBotToken}/${file.file_path}`;
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok || !fileResponse.body) {
        res.status(404).end();
        return;
      }

      res.setHeader('Content-Type', fileResponse.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      const buffer = Buffer.from(await fileResponse.arrayBuffer());
      res.send(buffer);
    } catch (error) {
      this.logger.warn(`streamAvatar failed for channel ${id}: ${(error as Error).message}`);
      res.status(404).end();
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

  async testMessage(id: string, companyId: string, dto: TestMessageDto): Promise<{ sent: boolean }> {
    const channel = await this.findOne(id, companyId);
    const provider = this.getProvider(channel.type);
    const sent = await provider.sendMessage(
      dto.channelUserId,
      { text: dto.text || '✅ Тестовое сообщение от TrafficCRM' },
      channel,
    );
    return { sent };
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
