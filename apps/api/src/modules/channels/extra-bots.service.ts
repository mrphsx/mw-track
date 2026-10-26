import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, ProjectBot } from '@prisma/client';
import { Api, Bot, GrammyError } from 'grammy';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatStoreService } from '../chat/chat-store.service';
import { TelegramProvider } from './providers/telegram.provider';

// Дополнительные боты проекта (запрос пользователя 2026-10-24) — см. ProjectBot в schema.prisma.
// Основной бот (Channel, TelegramProvider) не трогается: заявки в канал, статус бота у клиента и
// обычные рассылки остаются за ним. Дополнительный бот: свой вебхук, менеджеры (та же логика,
// что у основного, через TelegramProvider.useManagerInterceptor/useManagerCallbacks), чат и
// собственный список подписчиков. Клиентом CRM его собеседник автоматически не становится.
@Injectable()
export class ExtraBotsService implements OnModuleInit {
  private readonly logger = new Logger(ExtraBotsService.name);
  private bots = new Map<string, Bot>();

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private telegram: TelegramProvider,
    private chatStore: ChatStoreService,
  ) {}

  async onModuleInit(): Promise<void> {
    const active = await this.prisma.projectBot.findMany({ where: { isActive: true, deletedAt: null } });
    for (const projectBot of active) {
      // Сбой одного бота не должен мешать остальным и старту процесса.
      this.initialize(projectBot).catch((error) => this.recordError(projectBot.id, error));
    }
  }

  getBot(botId: string): Bot | undefined {
    return this.bots.get(botId);
  }

  private async recordError(botId: string, error: unknown): Promise<void> {
    const message = (error as Error).message;
    this.logger.warn(`Extra bot ${botId} init failed: ${message}`);
    await this.prisma.projectBot.update({ where: { id: botId }, data: { lastError: message } }).catch(() => {});
  }

  // Один и тот же бот не может работать в двух местах — setWebhook перехватил бы его у другого.
  private async assertTokenFree(tokenBotId: string, exceptBotId?: string): Promise<void> {
    if (await this.prisma.notificationBot.findUnique({ where: { tgBotId: tokenBotId }, select: { id: true } })) {
      throw new BadRequestException('Этот бот подключён для служебных оповещений компании — нужен отдельный бот из @BotFather');
    }
    const primary = await this.prisma.channel.findFirst({
      where: { type: 'TELEGRAM', isActive: true, tgBotToken: { startsWith: `${tokenBotId}:` }, project: { deletedAt: null } },
      select: { project: { select: { name: true } } },
    });
    if (primary) throw new BadRequestException(`Этот бот уже основной бот проекта «${primary.project.name}» — нужен отдельный бот`);
    const extra = await this.prisma.projectBot.findFirst({
      where: { tgBotId: tokenBotId, deletedAt: null, ...(exceptBotId ? { id: { not: exceptBotId } } : {}) },
      select: { id: true },
    });
    if (extra) throw new BadRequestException('Этот бот уже подключён как дополнительный бот');
  }

  private async initialize(projectBot: ProjectBot): Promise<void> {
    const channel = await this.prisma.channel.findUnique({ where: { projectId: projectBot.projectId } });
    if (!channel) throw new Error('У проекта нет канала');

    const bot = new Bot(projectBot.tgBotToken);

    // Правка сообщения клиентом (2026-10-26) — только в переписку CRM и дальше по цепочке не идёт:
    // фильтры команд grammY ловят и edited_message и падали бы на нём (ctx.message там пустой).
    bot.use(async (ctx, next) => {
      if (ctx.editedMessage) {
        await this.chatStore.recordEditedBotMessage(channel, ctx.editedMessage, projectBot.id);
        return;
      }
      await next();
    });
    // Для логики менеджеров — канал проекта с id и менеджерами этого бота: она читает только
    // id (ключи Redis), projectId и tgManagerUsernames (см. TelegramProvider.useManagerInterceptor).
    const managerChannel: Channel = { ...channel, id: projectBot.id, tgManagerUsernames: projectBot.tgManagerUsernames };

    this.telegram.useManagerInterceptor(bot, managerChannel);
    bot.use(async (ctx, next) => {
      if (ctx.message) await this.chatStore.recordIncomingBotMessage(channel, ctx.message, projectBot.id);
      await next();
    });
    this.telegram.useManagerCallbacks(bot, managerChannel);

    bot.on('message', async (ctx) => {
      if (ctx.chat.type !== 'private' || !ctx.from || ctx.from.is_bot) return;
      await this.recordSubscriber(projectBot, channel.projectId, ctx.from, { lastMessageAt: new Date() });
    });

    // Блокировка/разблокировка самим человеком — только для его собственной подписки на этого
    // бота; на статус основного бота у клиента не влияет.
    bot.on('my_chat_member', async (ctx) => {
      const update = ctx.myChatMember;
      if (update.chat.type !== 'private') return;
      const status = update.new_chat_member.status;
      await this.recordSubscriber(projectBot, channel.projectId, update.from, {
        isBlocked: status === 'kicked',
        blockedAt: status === 'kicked' ? new Date() : null,
      });
    });

    bot.catch((err) => this.logger.error(`Unhandled error in extra bot ${projectBot.id}: ${err.message}`));

    await bot.init();
    const webhookUrl = `${this.config.get<string>('API_URL')}/api/v1/webhooks/telegram-bot/${projectBot.id}`;
    await bot.api.setWebhook(webhookUrl, { allowed_updates: ['message', 'edited_message', 'my_chat_member', 'callback_query'] });

    let avatarFileId: string | undefined;
    try {
      const me = await bot.api.getChat(bot.botInfo.id);
      avatarFileId = me.photo?.big_file_id;
    } catch {
      // аватар не обязателен
    }
    await this.prisma.projectBot.update({
      where: { id: projectBot.id },
      data: {
        tgBotUsername: bot.botInfo.username,
        tgBotFirstName: bot.botInfo.first_name,
        tgAvatarFileId: avatarFileId ?? null,
        isActive: true,
        lastError: null,
      },
    });
    this.bots.set(projectBot.id, bot);
  }

  private async recordSubscriber(
    projectBot: ProjectBot,
    projectId: string,
    from: { id: number; username?: string; first_name: string; last_name?: string },
    patch: { lastMessageAt?: Date; isBlocked?: boolean; blockedAt?: Date | null },
  ): Promise<void> {
    try {
      const tgUserId = String(from.id);
      const client = await this.prisma.client.findFirst({ where: { projectId, tgUserId, deletedAt: null }, select: { id: true } });
      await this.prisma.projectBotSubscriber.upsert({
        where: { botId_tgUserId: { botId: projectBot.id, tgUserId } },
        create: {
          botId: projectBot.id,
          tgUserId,
          tgUsername: from.username,
          tgFirstName: from.first_name,
          tgLastName: from.last_name,
          clientId: client?.id,
          lastMessageAt: patch.lastMessageAt,
          isBlocked: patch.isBlocked ?? false,
          blockedAt: patch.blockedAt ?? null,
        },
        update: {
          tgUsername: from.username ?? null,
          tgFirstName: from.first_name,
          tgLastName: from.last_name ?? null,
          ...(client ? { clientId: client.id } : {}),
          ...(patch.lastMessageAt ? { lastMessageAt: patch.lastMessageAt, isBlocked: false, blockedAt: null } : {}),
          ...(patch.isBlocked !== undefined ? { isBlocked: patch.isBlocked, blockedAt: patch.blockedAt ?? null } : {}),
        },
      });
    } catch (error) {
      this.logger.warn(`recordSubscriber failed for extra bot ${projectBot.id}: ${(error as Error).message}`);
    }
  }

  async handleWebhook(botId: string, update: object): Promise<void> {
    void this.prisma.projectBot
      .update({ where: { id: botId }, data: { lastWebhookAt: new Date() } })
      .catch(() => {});
    const bot = this.bots.get(botId);
    if (!bot) {
      this.logger.warn(`handleWebhook: no extra bot instance ${botId}`);
      return;
    }
    await bot.handleUpdate(update as Parameters<Bot['handleUpdate']>[0]);
  }

  // ---- управление из настроек проекта ----

  async list(projectId: string) {
    const bots = await this.prisma.projectBot.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        tgBotUsername: true,
        tgBotFirstName: true,
        tgAvatarFileId: true,
        tgManagerUsernames: true,
        isActive: true,
        lastError: true,
        lastWebhookAt: true,
        createdAt: true,
        _count: { select: { subscribers: true } },
      },
    });
    return bots.map(({ _count, tgAvatarFileId, ...b }) => ({ ...b, hasAvatar: !!tgAvatarFileId, subscribers: _count.subscribers }));
  }

  async add(projectId: string, companyId: string, userId: string, rawToken: string) {
    const token = rawToken.trim();
    if (!/^\d+:[\w-]{30,}$/.test(token)) {
      throw new BadRequestException('Это не похоже на токен бота — скопируйте его целиком из @BotFather (вида 123456:ABC…)');
    }
    const channel = await this.prisma.channel.findUnique({ where: { projectId }, select: { type: true } });
    if (channel?.type !== 'TELEGRAM') throw new BadRequestException('Дополнительные боты доступны только для Telegram-проектов');

    const tokenBotId = token.split(':')[0];
    await this.assertTokenFree(tokenBotId);
    try {
      await new Api(token).getMe();
    } catch (error) {
      if (error instanceof GrammyError && (error.error_code === 401 || error.error_code === 404)) {
        throw new BadRequestException('Telegram не принял токен — проверьте его в @BotFather');
      }
      throw new BadRequestException('Не удалось связаться с Telegram, попробуйте ещё раз');
    }

    const created = await this.prisma.projectBot.create({
      data: { companyId, projectId, tgBotToken: token, tgBotId: tokenBotId, createdById: userId },
    });
    try {
      await this.initialize(created);
    } catch (error) {
      // Не смогли запустить — бот не остаётся висеть полуподключённым.
      await this.prisma.projectBot.update({ where: { id: created.id }, data: { deletedAt: new Date(), isActive: false, lastError: (error as Error).message } });
      throw new BadRequestException(`Не удалось подключить бота: ${(error as Error).message}`);
    }
    return this.findOne(projectId, created.id);
  }

  private async findOne(projectId: string, botId: string) {
    const bot = (await this.list(projectId)).find((b) => b.id === botId);
    if (!bot) throw new NotFoundException('Бот не найден');
    return bot;
  }

  private async load(projectId: string, botId: string): Promise<ProjectBot> {
    const bot = await this.prisma.projectBot.findFirst({ where: { id: botId, projectId, deletedAt: null } });
    if (!bot) throw new NotFoundException('Бот не найден');
    return bot;
  }

  // Менеджеры зашиты в обработчики при запуске — после правки бот перезапускается.
  async updateManagers(projectId: string, botId: string, usernames: string[]) {
    await this.load(projectId, botId);
    const clean = [...new Set(usernames.map((u) => u.trim().replace(/^@/, '')).filter(Boolean))];
    const updated = await this.prisma.projectBot.update({ where: { id: botId }, data: { tgManagerUsernames: clean } });
    await this.initialize(updated).catch((error) => this.recordError(botId, error));
    return this.findOne(projectId, botId);
  }

  async reconnect(projectId: string, botId: string) {
    const bot = await this.load(projectId, botId);
    await this.assertTokenFree(bot.tgBotId, bot.id);
    try {
      await this.initialize(bot);
    } catch (error) {
      await this.recordError(botId, error);
      throw new BadRequestException(`Не удалось подключить бота: ${(error as Error).message}`);
    }
    return this.findOne(projectId, botId);
  }

  // Мягкое удаление: вебхук снимается, переписка и подписчики остаются в истории.
  async remove(projectId: string, botId: string) {
    const bot = await this.load(projectId, botId);
    try {
      await (this.bots.get(botId)?.api ?? new Api(bot.tgBotToken)).deleteWebhook();
    } catch (error) {
      this.logger.warn(`deleteWebhook failed for extra bot ${botId}: ${(error as Error).message}`);
    }
    this.bots.delete(botId);
    await this.prisma.projectBot.update({ where: { id: botId }, data: { deletedAt: new Date(), isActive: false } });
    return { ok: true };
  }

  async getToken(botId: string): Promise<string | null> {
    const bot = await this.prisma.projectBot.findUnique({ where: { id: botId }, select: { tgBotToken: true } });
    return bot?.tgBotToken ?? null;
  }
}
