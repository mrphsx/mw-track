import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'crypto';
import { GrammyError } from 'grammy';
import { EncryptionService } from '../../common/encryption.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateNotificationRecipientDto, UpdateNotificationRecipientDto } from './dto/notification-recipient.dto';
import {
  ChatProfile,
  classifyTelegramError,
  describeTelegramError,
  fetchChatProfile,
  notifierApi,
  sendNotifierMessage,
} from './notification-telegram';
import {
  escapeTelegramHtml,
  extractBotIdFromToken,
  NOTIFICATION_TYPE_META,
  NOTIFICATION_TYPES,
  normalizeTelegramUsername,
  TELEGRAM_USERNAME_PATTERN,
} from './notification-types';
import { NotificationsEvaluator } from './notifications-evaluator.service';

// Минимальная форма апдейта Telegram, которая нам нужна, — без зависимости от типов grammY Bot.
interface IncomingUpdate {
  message?: {
    text?: string;
    chat?: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string; is_bot?: boolean };
  };
}

// Сверять профиль не чаще этого: сообщения и так приносят его бесплатно, а фоновая сверка
// (refreshStaleProfiles) трогает только тех, о ком дольше этого срока не было вестей — в итоге
// не больше двух запросов getChat в сутки на получателя.
const PROFILE_STALE_MS = 12 * 60 * 60 * 1000;
const PROFILE_REFRESH_BATCH = 200;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private encryption: EncryptionService,
    private evaluator: NotificationsEvaluator,
  ) {}

  async getSettings(companyId: string) {
    const bot = await this.prisma.notificationBot.findUnique({
      where: { companyId },
      select: {
        id: true,
        tgBotUsername: true,
        isActive: true,
        lastError: true,
        createdAt: true,
        recipients: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            username: true,
            tgUserId: true,
            tgFirstName: true,
            chatId: true,
            linkedAt: true,
            enabledTypes: true,
            lastError: true,
          },
        },
      },
    });
    return {
      // Токен и секрет вебхука никогда не уходят на клиент.
      bot: bot && {
        id: bot.id,
        tgBotUsername: bot.tgBotUsername,
        isActive: bot.isActive,
        lastError: bot.lastError,
        createdAt: bot.createdAt,
      },
      recipients: (bot?.recipients ?? []).map(({ chatId, ...r }) => ({ ...r, linked: !!chatId })),
      types: NOTIFICATION_TYPES.map((id) => ({ id, ...NOTIFICATION_TYPE_META[id] })),
    };
  }

  async connectBot(companyId: string, rawToken: string) {
    const token = rawToken.trim();
    const tgBotId = extractBotIdFromToken(token);
    if (!tgBotId) {
      throw new BadRequestException('Неверный формат токена. Скопируйте токен целиком из @BotFather — вида 123456789:AAF…');
    }

    if (await this.prisma.notificationBot.findUnique({ where: { companyId }, select: { id: true } })) {
      throw new ConflictException('Бот оповещений уже подключён. Отключите его, чтобы подключить другой.');
    }

    // Один бот не может обслуживать два вебхука: setWebhook ниже молча отобрал бы обновления у бота
    // проекта, и тот перестал бы регистрировать подписчиков (инцидент 2026-08-05). Архивные проекты
    // не считаются — при архивации их вебхук уже снят.
    const channelConflict = await this.prisma.channel.findFirst({
      where: { tgBotToken: { startsWith: `${tgBotId}:` }, project: { deletedAt: null } },
      select: { project: { select: { name: true, companyId: true } } },
    });
    if (channelConflict) {
      // Имя чужого проекта не раскрываем — только своего.
      const where = channelConflict.project.companyId === companyId ? ` проекта «${channelConflict.project.name}»` : ' другого проекта';
      throw new ConflictException(
        `Этот бот уже работает как бот канала${where}. Создайте для оповещений отдельного бота через @BotFather.`,
      );
    }
    if (await this.prisma.notificationBot.findUnique({ where: { tgBotId }, select: { id: true } })) {
      throw new ConflictException('Этот бот уже подключён для оповещений в другой компании.');
    }

    const api = notifierApi(token);
    let username: string;
    try {
      const me = await api.getMe();
      if (String(me.id) !== tgBotId) throw new BadRequestException('Токен не соответствует боту — скопируйте его заново.');
      username = me.username;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof GrammyError && error.error_code === 401) {
        throw new BadRequestException('Telegram не принял токен: бот удалён или токен перевыпущен. Возьмите актуальный в @BotFather.');
      }
      this.logger.warn(`getMe для бота оповещений не прошёл: ${describeTelegramError(error)}`);
      throw new BadRequestException(`Не удалось связаться с Telegram: ${describeTelegramError(error)}`);
    }

    const webhookSecret = randomBytes(24).toString('hex');
    let row;
    try {
      row = await this.prisma.notificationBot.create({
        data: {
          companyId,
          tgBotId,
          tgBotUsername: username,
          tokenEncrypted: this.encryption.encrypt(token),
          webhookSecret,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Этот бот уже подключён — обновите страницу.');
      }
      throw error;
    }

    const webhookUrl = `${this.config.get<string>('API_URL')}/api/v1/webhooks/notifier/${row.id}`;
    try {
      await api.setWebhook(webhookUrl, {
        secret_token: webhookSecret,
        // Боту оповещений нужны только личные сообщения (/start, /stop).
        allowed_updates: ['message'],
        drop_pending_updates: true,
      });
    } catch (error) {
      // Без вебхука бот не узнает ни одного chat_id — подключение бессмысленно, откатываем.
      await this.prisma.notificationBot.delete({ where: { id: row.id } });
      this.logger.warn(`setWebhook для бота оповещений не прошёл: ${describeTelegramError(error)}`);
      throw new BadRequestException(`Telegram не принял адрес вебхука: ${describeTelegramError(error)}`);
    }

    // Состояние прошлых алертов (если бот переподключают) сбрасываем: пусть текущие проблемы
    // придут заново на новый бот, а не считаются уже отправленными через старый.
    await this.prisma.notificationAlertState.deleteMany({ where: { companyId } });
    this.logger.log(`Бот оповещений @${username} подключён для компании ${companyId}`);
    return this.getSettings(companyId);
  }

  async disconnectBot(companyId: string) {
    const bot = await this.prisma.notificationBot.findUnique({ where: { companyId } });
    if (!bot) throw new NotFoundException('Бот оповещений не подключён');
    try {
      await notifierApi(this.encryption.decrypt(bot.tokenEncrypted)).deleteWebhook();
    } catch (error) {
      // Токен мог быть уже отозван — отключение в CRM всё равно должно пройти.
      this.logger.warn(`deleteWebhook бота оповещений не прошёл: ${describeTelegramError(error)}`);
    }
    await this.prisma.notificationBot.delete({ where: { id: bot.id } });
    await this.prisma.notificationAlertState.deleteMany({ where: { companyId } });
    return this.getSettings(companyId);
  }

  async addRecipient(companyId: string, dto: CreateNotificationRecipientDto) {
    const bot = await this.requireBot(companyId);
    const username = normalizeTelegramUsername(dto.username);
    if (!TELEGRAM_USERNAME_PATTERN.test(username)) {
      throw new BadRequestException('Юзернейм Telegram — 5–32 символа: латиница, цифры и подчёркивание.');
    }
    // Уникального индекса на юзернейм нет (его держит tgUserId, см. schema.prisma), поэтому дубль
    // проверяем здесь — в том числе против подключённых получателей с этим же текущим юзернеймом.
    const existing = await this.prisma.notificationRecipient.findFirst({
      where: { notificationBotId: bot.id, username },
      select: { id: true },
    });
    if (existing) throw new ConflictException(`@${username} уже в списке получателей`);
    await this.prisma.notificationRecipient.create({
      data: {
        notificationBotId: bot.id,
        username,
        enabledTypes: dto.enabledTypes ?? [...NOTIFICATION_TYPES],
      },
    });
    return this.getSettings(companyId);
  }

  async updateRecipient(companyId: string, id: string, dto: UpdateNotificationRecipientDto) {
    await this.requireRecipient(companyId, id);
    await this.prisma.notificationRecipient.update({ where: { id }, data: { enabledTypes: dto.enabledTypes } });
    return this.getSettings(companyId);
  }

  async removeRecipient(companyId: string, id: string) {
    await this.requireRecipient(companyId, id);
    await this.prisma.notificationRecipient.delete({ where: { id } });
    return this.getSettings(companyId);
  }

  // Синхронно, в обход очереди — единственное исключение: это разовое действие владельца, которому
  // нужен немедленный ответ "дошло/не дошло", а не "поставлено в очередь".
  async sendTest(companyId: string, id: string) {
    const recipient = await this.requireRecipient(companyId, id);
    if (!recipient.chatId) {
      throw new BadRequestException(`${this.recipientLabel(recipient)} ещё не нажал Start в боте — отправить некуда.`);
    }
    const bot = await this.requireBot(companyId);
    try {
      const profile = await sendNotifierMessage(
        this.encryption.decrypt(bot.tokenEncrypted),
        recipient.chatId,
        '🔔 <b>Тестовое оповещение MWTRACK.</b>\nЕсли вы это видите — доставка работает.',
      );
      if (profile) await this.syncProfile(recipient.id, profile);
    } catch (error) {
      const kind = classifyTelegramError(error);
      await this.recordDeliveryFailure(bot.id, recipient.id, kind, error);
      throw new BadRequestException(`Не доставлено: ${describeTelegramError(error)}`);
    }
    await this.prisma.notificationRecipient.update({ where: { id }, data: { lastError: null } });
    return { ok: true };
  }

  // Вызывается вебхуком. Всегда "проглатывает" ошибки обработки: иначе Telegram будет бесконечно
  // повторять один и тот же апдейт.
  async handleUpdate(notificationBotId: string, secretHeader: string | undefined, update: IncomingUpdate): Promise<void> {
    const bot = await this.prisma.notificationBot.findUnique({ where: { id: notificationBotId } });
    if (!bot) return;
    if (!this.secretMatches(bot.webhookSecret, secretHeader)) {
      throw new UnauthorizedException();
    }

    const message = update.message;
    const text = message?.text?.trim() ?? '';
    const chatId = message?.chat?.id;
    // Только личные чаты с человеком: в группу бота могут добавить, но оповещения туда не для того.
    if (!message || !chatId || message.chat?.type !== 'private' || message.from?.is_bot) return;

    // Расшифровка внутри обработки ошибок, а не до неё: повреждённая строка или сменённый ключ
    // шифрования иначе давали бы 500 — и Telegram повторял бы один и тот же апдейт бесконечно.
    let token: string;
    try {
      token = this.encryption.decrypt(bot.tokenEncrypted);
    } catch (error) {
      this.logger.error(`Токен бота оповещений ${bot.id} не расшифровывается: ${(error as Error).message}`);
      await this.prisma.notificationBot.update({
        where: { id: bot.id },
        data: { isActive: false, lastError: 'Сохранённый токен повреждён — отключите и подключите бота заново' },
      });
      return;
    }
    const reply = async (html: string) => {
      try {
        await sendNotifierMessage(token, String(chatId), html);
      } catch (error) {
        this.logger.warn(`Ответ ботом оповещений не отправлен: ${describeTelegramError(error)}`);
      }
    };

    const fromId = message.from?.id ? String(message.from.id) : null;
    const incomingProfile: ChatProfile = {
      username: message.from?.username ?? null,
      firstName: message.from?.first_name ?? null,
    };

    try {
      // Любое сообщение от уже известного получателя — бесплатная сверка его юзернейма и имени.
      const known = fromId
        ? await this.prisma.notificationRecipient.findUnique({
            where: { notificationBotId_tgUserId: { notificationBotId: bot.id, tgUserId: fromId } },
          })
        : null;
      if (known) await this.syncProfile(known.id, incomingProfile);

      if (/^\/stop\b/i.test(text)) {
        // tgUserId не трогаем: человек остаётся опознаваемым и после переименования сможет
        // вернуться простым /start.
        const unlinked = await this.prisma.notificationRecipient.updateMany({
          where: { notificationBotId: bot.id, chatId: String(chatId) },
          data: { chatId: null, linkedAt: null },
        });
        await reply(
          unlinked.count
            ? 'Оповещения отключены. Чтобы снова получать их, отправьте /start.'
            : 'Вы и так не получаете оповещения.',
        );
        return;
      }

      if (!/^\/start\b/i.test(text)) {
        await reply('Этот бот присылает служебные оповещения MWTRACK.\n/start — подписаться\n/stop — отписаться');
        return;
      }

      // 1) Уже знакомый по id — это он, даже если с тех пор сменил или убрал юзернейм.
      // 2) Иначе — строка, которую владелец вписал по юзернейму и которая ещё ни к кому не
      //    привязана. Строку, уже привязанную к ДРУГОМУ id, не отдаём: юзернейм мог перейти к
      //    другому человеку, и получить чужие оповещения, просто заняв освободившееся имя, нельзя.
      let recipient = known;
      if (!recipient) {
        const username = incomingProfile.username ? normalizeTelegramUsername(incomingProfile.username) : null;
        if (!username) {
          await reply(
            'У вашего аккаунта нет юзернейма. Задайте его в настройках Telegram, передайте владельцу компании ' +
              'и снова нажмите /start.',
          );
          return;
        }
        const pending = await this.prisma.notificationRecipient.findFirst({
          where: { notificationBotId: bot.id, username, tgUserId: null },
        });
        if (!pending) {
          await reply(
            `@${escapeTelegramHtml(username)} нет в списке получателей. Попросите владельца компании добавить вас ` +
              'в MWTRACK: Настройки → Оповещения, затем снова нажмите /start.',
          );
          return;
        }
        recipient = pending;
      }

      await this.prisma.notificationRecipient.update({
        where: { id: recipient.id },
        data: {
          tgUserId: fromId,
          chatId: String(chatId),
          linkedAt: recipient.linkedAt ?? new Date(),
          lastError: null,
        },
      });
      recipient = await this.syncProfile(recipient.id, incomingProfile);

      const company = await this.prisma.company.findUnique({ where: { id: bot.companyId }, select: { name: true } });
      const types = recipient.enabledTypes
        .filter((t): t is keyof typeof NOTIFICATION_TYPE_META => t in NOTIFICATION_TYPE_META)
        .map((t) => `• ${escapeTelegramHtml(NOTIFICATION_TYPE_META[t].label)}`);
      const active = await this.evaluator.describeActive(bot.companyId, recipient.enabledTypes);

      let html =
        `✅ <b>Вы подписаны на оповещения компании «${escapeTelegramHtml(company?.name ?? '')}».</b>\n\n` +
        (types.length ? `Вы получаете:\n${types.join('\n')}` : 'Пока ни один тип оповещений не выбран — владелец может включить их в настройках.');
      if (active.length) html += `\n\n<b>Прямо сейчас:</b>\n\n${active.map((a) => `⚠️ ${a}`).join('\n\n')}`;
      await reply(html);
    } catch (error) {
      this.logger.error(`Обработка апдейта бота оповещений упала: ${(error as Error).message}`);
    }
  }

  // Приводит сохранённые юзернейм и имя к тому, что сообщил Telegram. Пишет в базу только если что-то
  // изменилось или давно не сверялось — сообщения идут часто, лишние UPDATE ни к чему.
  //
  // Если новое имя совпало с ещё не привязанной строкой того же бота — это тот же человек (юзернеймы
  // в Telegram уникальны): владелец вписал его повторно под новым именем. Такую строку вливаем сюда
  // (объединяем выбранные типы) и удаляем, иначе она висела бы вечным "ждём Start".
  async syncProfile(recipientId: string, profile: ChatProfile) {
    const current = await this.prisma.notificationRecipient.findUniqueOrThrow({ where: { id: recipientId } });
    const username = profile.username ? normalizeTelegramUsername(profile.username) : null;
    const firstName = profile.firstName?.slice(0, 128) ?? null;
    const changed = current.username !== username || current.tgFirstName !== firstName;
    const stale = !current.profileCheckedAt || Date.now() - current.profileCheckedAt.getTime() > PROFILE_STALE_MS;
    if (!changed && !stale) return current;

    let enabledTypes = current.enabledTypes;
    if (changed && username) {
      const duplicates = await this.prisma.notificationRecipient.findMany({
        where: { notificationBotId: current.notificationBotId, username, tgUserId: null, id: { not: current.id } },
      });
      if (duplicates.length) {
        enabledTypes = [...new Set([...enabledTypes, ...duplicates.flatMap((d) => d.enabledTypes)])];
        await this.prisma.notificationRecipient.deleteMany({ where: { id: { in: duplicates.map((d) => d.id) } } });
      }
    }
    if (current.username !== username) {
      this.logger.log(`Получатель ${current.id}: юзернейм ${current.username ?? '—'} → ${username ?? '—'}`);
    }
    return this.prisma.notificationRecipient.update({
      where: { id: current.id },
      data: { username, tgFirstName: firstName, profileCheckedAt: new Date(), enabledTypes },
    });
  }

  // Фоновая сверка для тех, кому давно ничего не отправляли и кто сам не писал боту: без неё
  // переименование такого получателя было бы видно в CRM только с его следующим оповещением.
  // Один getChat на получателя, только для "протухших", последовательно — нагрузка копеечная.
  async refreshStaleProfiles(): Promise<number> {
    const threshold = new Date(Date.now() - PROFILE_STALE_MS);
    const recipients = await this.prisma.notificationRecipient.findMany({
      where: {
        chatId: { not: null },
        notificationBot: { isActive: true },
        OR: [{ profileCheckedAt: null }, { profileCheckedAt: { lt: threshold } }],
      },
      orderBy: { profileCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: PROFILE_REFRESH_BATCH,
      include: { notificationBot: { select: { id: true, tokenEncrypted: true } } },
    });

    const tokens = new Map<string, string | null>();
    const deadBots = new Set<string>();
    let refreshed = 0;
    for (const recipient of recipients) {
      const botId = recipient.notificationBot.id;
      if (deadBots.has(botId)) continue;
      if (!tokens.has(botId)) {
        try {
          tokens.set(botId, this.encryption.decrypt(recipient.notificationBot.tokenEncrypted));
        } catch {
          tokens.set(botId, null);
        }
      }
      const token = tokens.get(botId);
      if (!token) continue;
      try {
        const profile = await this.fetchProfile(token, recipient.chatId!);
        if (profile) {
          await this.syncProfile(recipient.id, profile);
          refreshed++;
        }
      } catch (error) {
        // Telegram просит притормозить — дальше в этом прогоне не спрашиваем никого,
        // остальные подождут следующего запуска.
        if (error instanceof GrammyError && error.error_code === 429) break;
        const kind = classifyTelegramError(error);
        if (kind !== 'RETRYABLE') {
          await this.recordDeliveryFailure(botId, recipient.id, kind, error);
          if (kind === 'BOT_UNAUTHORIZED') deadBots.add(botId);
        }
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    return refreshed;
  }

  // Отдельный метод, а не прямой вызов — точка подмены для проверки без настоящего бота.
  protected fetchProfile(token: string, chatId: string): Promise<ChatProfile | null> {
    return fetchChatProfile(token, chatId);
  }

  recipientLabel(recipient: { username: string | null; tgFirstName: string | null; tgUserId: string | null }): string {
    if (recipient.username) return `@${recipient.username}`;
    return recipient.tgFirstName || `id ${recipient.tgUserId}`;
  }

  async recordDeliveryFailure(botId: string, recipientId: string, kind: ReturnType<typeof classifyTelegramError>, error: unknown) {
    if (kind === 'RECIPIENT_UNREACHABLE') {
      await this.prisma.notificationRecipient.update({
        where: { id: recipientId },
        data: {
          chatId: null,
          linkedAt: null,
          lastError: 'Получатель заблокировал бота или удалил чат — нужно снова нажать /start',
        },
      });
    } else if (kind === 'BOT_UNAUTHORIZED') {
      await this.prisma.notificationBot.update({
        where: { id: botId },
        data: { isActive: false, lastError: 'Telegram отозвал токен бота — отключите и подключите бота заново' },
      });
    } else {
      await this.prisma.notificationRecipient.update({
        where: { id: recipientId },
        data: { lastError: `Ошибка доставки: ${describeTelegramError(error)}`.slice(0, 500) },
      });
    }
  }

  private secretMatches(expected: string, received: string | undefined): boolean {
    if (!received) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async requireBot(companyId: string) {
    const bot = await this.prisma.notificationBot.findUnique({ where: { companyId } });
    if (!bot) throw new BadRequestException('Сначала подключите бота оповещений');
    return bot;
  }

  // Получатель ищется через бота компании — id из URL никогда не даёт доступа к чужой компании.
  private async requireRecipient(companyId: string, id: string) {
    const recipient = await this.prisma.notificationRecipient.findFirst({
      where: { id, notificationBot: { companyId } },
    });
    if (!recipient) throw new NotFoundException('Получатель не найден');
    return recipient;
  }
}
