import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '@prisma/client';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { RPCError } from 'telegram/errors';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { EncryptionService } from '../../../common/encryption.service';
import { ClientsService } from '../../clients/clients.service';
import { VideoProcessingService } from '../video-processing.service';
import { CustomFile } from 'telegram/client/uploads';

interface PendingConnection {
  client: TelegramClient;
  phoneCodeHash: string;
  phone: string;
  createdAt: number;
}

const ATTEMPT_TTL_MS = 10 * 60 * 1000;

// Подключение личного Telegram-аккаунта через MTProto (не Bot API) — запрос пользователя
// 2026-07-04, "диалоги с клиентами" для режима PERSONAL_DM, который сегодня вообще не имеет
// бэкенда (статичная ссылка, ни токена, ни вебхука). Использует GramJS (пакет `telegram`,
// ближайший аналог Python-Telethon для Node). Живые TelegramClient-инстансы держим в памяти
// процесса — тот же паттерн, что TelegramProvider.bots для ботов, сериализовать живой сокет
// в БД/Redis нельзя. При рестарте процесса onModuleInit в ChannelsService должен заново
// поднять слушатели для уже подключённых каналов (см. startListening).
@Injectable()
export class TelegramPersonalService {
  private readonly logger = new Logger(TelegramPersonalService.name);
  private pending = new Map<string, PendingConnection>();
  private liveClients = new Map<string, TelegramClient>();

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private redis: RedisService,
    private encryption: EncryptionService,
    private clientsService: ClientsService,
    private videoProcessing: VideoProcessingService,
  ) {}

  private getApiCredentials(): { apiId: number; apiHash: string } {
    const apiId = this.config.get<string>('TELEGRAM_API_ID');
    const apiHash = this.config.get<string>('TELEGRAM_API_HASH');
    if (!apiId || !apiHash) {
      throw new BadRequestException(
        'TELEGRAM_API_ID/TELEGRAM_API_HASH не настроены на сервере — их нужно получить на my.telegram.org и добавить в .env.prod',
      );
    }
    return { apiId: Number(apiId), apiHash };
  }

  // Шаг 1 — номер телефона, Telegram присылает код в приложение (или SMS).
  async startConnect(channel: Channel, phone: string): Promise<void> {
    const { apiId, apiHash } = this.getApiCredentials();
    const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });
    await client.connect();

    try {
      const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, phone);
      this.pending.set(channel.id, { client, phoneCodeHash, phone, createdAt: Date.now() });
    } catch (error) {
      await client.destroy();
      throw new BadRequestException(`Не удалось отправить код: ${(error as Error).message}`);
    }
  }

  // Шаг 2 — код из Telegram/SMS. Если у аккаунта включена 2FA, Telegram отвечает
  // SESSION_PASSWORD_NEEDED вместо завершения входа — сообщаем фронту показать шаг 3.
  async submitCode(channel: Channel, code: string): Promise<{ needsPassword: boolean }> {
    const attempt = this.getPendingAttempt(channel.id);

    try {
      await attempt.client.invoke(
        new Api.auth.SignIn({ phoneNumber: attempt.phone, phoneCodeHash: attempt.phoneCodeHash, phoneCode: code }),
      );
    } catch (error) {
      if (error instanceof RPCError && error.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        return { needsPassword: true };
      }
      this.pending.delete(channel.id);
      throw new BadRequestException('Неверный код или срок его действия истёк, начните заново');
    }

    await this.finalizeConnection(channel, attempt);
    return { needsPassword: false };
  }

  // Шаг 3 (только если аккаунт защищён 2FA) — пароль. GramJS сам считает SRP-проверку.
  async submitPassword(channel: Channel, password: string): Promise<void> {
    const attempt = this.getPendingAttempt(channel.id);
    const { apiId, apiHash } = this.getApiCredentials();

    try {
      await attempt.client.signInWithPassword(
        { apiId, apiHash },
        {
          password: async () => password,
          onError: async (err) => {
            throw err;
          },
        },
      );
    } catch {
      this.pending.delete(channel.id);
      throw new BadRequestException('Неверный пароль двухфакторной аутентификации, начните заново');
    }

    await this.finalizeConnection(channel, attempt);
  }

  async disconnect(channel: Channel): Promise<void> {
    const live = this.liveClients.get(channel.id);
    if (live) {
      try {
        await live.invoke(new Api.auth.LogOut());
      } catch (error) {
        // Сессия могла уже быть недействительной на стороне Telegram — не блокируем очистку.
        this.logger.warn(`LogOut failed for channel ${channel.id}: ${(error as Error).message}`);
      }
      await live.destroy();
      this.liveClients.delete(channel.id);
    }

    await this.prisma.channel.update({
      where: { id: channel.id },
      data: { tgPersonalPhone: null, tgPersonalUserId: null, tgSessionEncrypted: null },
    });
  }

  // Поднимает живое соединение для уже подключённого канала — вызывается и сразу после
  // finalizeConnection, и при рестарте процесса (см. ChannelsService.onModuleInit).
  async startListening(channel: Channel): Promise<void> {
    if (!channel.tgSessionEncrypted || this.liveClients.has(channel.id)) return;

    const { apiId, apiHash } = this.getApiCredentials();
    const session = new StringSession(this.encryption.decrypt(channel.tgSessionEncrypted));
    const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
    await client.connect();

    client.addEventHandler(
      (event: NewMessageEvent) => this.handleIncomingMessage(channel, event),
      new NewMessage({ incoming: true }),
    );

    this.liveClients.set(channel.id, client);
  }

  // Модуль "Истории" (запрос пользователя 2026-07-21) — живой клиент нужен не только для
  // чтения входящих диалогов, но и для публикации Story. Один и тот же MTProto-сокет спокойно
  // обслуживает оба назначения одновременно (GramJS мультиплексирует invoke() по одному
  // соединению) — ленивая регидратация через уже существующий startListening на случай, если
  // канал подключён, но живого клиента в памяти ещё нет (например сразу после рестарта API,
  // до того как onModuleInit успел пройтись по всем каналам).
  async getLiveClient(channel: Channel): Promise<TelegramClient | undefined> {
    if (!this.liveClients.has(channel.id)) {
      await this.startListening(channel);
    }
    return this.liveClients.get(channel.id);
  }

  // Публикация Telegram Story через личный аккаунт (запрос пользователя 2026-07-21, модуль
  // "Истории") — в GramJS нет готовой обёртки sendStory(), вызываем сырой MTProto-метод
  // напрямую, тем же приёмом, что уже используется здесь для Api.auth.SignIn/LogOut.
  // peer: InputPeerSelf — публикуем в СВОЮ историю (весь смысл модуля — свой личный аккаунт).
  // privacyRules зафиксированы на "видно всем" — настраиваемую приватность не делаем, не
  // просили. period не передаём — Telegram сам ставит стандартные 24 часа.
  async sendStory(
    channel: Channel,
    params: { buffer: Buffer; mimeType: string; isVideo: boolean; caption?: string },
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getLiveClient(channel);
    if (!client) return { success: false, error: 'Личный аккаунт не подключён или недоступен' };

    try {
      const file = new CustomFile(
        params.isVideo ? 'story.mp4' : 'story.jpg',
        params.buffer.length,
        '',
        params.buffer,
      );
      const uploaded = await client.uploadFile({ file, workers: 1 });

      const media = params.isVideo
        ? await this.buildVideoMedia(uploaded, params.buffer, params.mimeType)
        : new Api.InputMediaUploadedPhoto({ file: uploaded });

      await client.invoke(
        new Api.stories.SendStory({
          peer: new Api.InputPeerSelf(),
          media,
          caption: params.caption,
          privacyRules: [new Api.InputPrivacyValueAllowAll()],
        }),
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  // DocumentAttributeVideo требует width/height/duration обязательными полями (не Optional в
  // TL-схеме) — в отличие от video_note (ensureSquareVideoNote), здесь не перекодируем и не
  // обрезаем, только считываем метаданные уже присланного файла через ffprobe.
  private async buildVideoMedia(uploaded: Api.InputFile | Api.InputFileBig, buffer: Buffer, mimeType: string) {
    const probe = await this.videoProcessing.probeBuffer(buffer);
    return new Api.InputMediaUploadedDocument({
      file: uploaded,
      mimeType,
      attributes: [
        new Api.DocumentAttributeVideo({
          duration: probe.durationSeconds,
          w: probe.width ?? 0,
          h: probe.height ?? 0,
          supportsStreaming: true,
        }),
      ],
    });
  }

  private getPendingAttempt(channelId: string): PendingConnection {
    const attempt = this.pending.get(channelId);
    if (!attempt || Date.now() - attempt.createdAt > ATTEMPT_TTL_MS) {
      this.pending.delete(channelId);
      throw new BadRequestException('Сессия подключения истекла, начните заново');
    }
    return attempt;
  }

  private async finalizeConnection(channel: Channel, attempt: PendingConnection): Promise<void> {
    this.pending.delete(channel.id);

    const me = await attempt.client.getMe();
    const sessionString = (attempt.client.session as StringSession).save() as unknown as string;

    await this.prisma.channel.update({
      where: { id: channel.id },
      data: {
        tgPersonalPhone: attempt.phone,
        tgPersonalUserId: String(me.id),
        tgSessionEncrypted: this.encryption.encrypt(sessionString),
      },
    });

    this.liveClients.set(channel.id, attempt.client);
    attempt.client.addEventHandler(
      (event: NewMessageEvent) => this.handleIncomingMessage(channel, event),
      new NewMessage({ incoming: true }),
    );
  }

  // Не блокирует и не бросает наружу — сбой обработки одного сообщения не должен убить
  // live-соединение (тот же принцип best-effort, что и у TelegramProvider.handleIncomingText).
  private async handleIncomingMessage(channel: Channel, event: NewMessageEvent): Promise<void> {
    try {
      if (!event.isPrivate) return;

      const sender = await event.message.getSender();
      if (!sender || sender.className !== 'User' || (sender as Api.User).bot) return;

      const tgUserId = String(sender.id);
      const user = sender as Api.User;

      const existingClient = await this.clientsService.findByTgId(tgUserId, channel.projectId);
      let landingId: string | undefined;
      let buyerId: string | undefined;

      // Атрибуция лендинга — только на первом сообщении (см. telegram-link.util.ts &text=,
      // "честное ограничение": код виден и может быть стёрт до отправки). Метка баера
      // (Фаза 3.6) — из того же блока, тем же путём, что и landingId.
      if (!existingClient) {
        const text = event.message.text?.trim();
        if (text) {
          const cached = await this.redis.get(`start:${text}`);
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              landingId = parsed.landingId ?? undefined;
              buyerId = parsed.buyerRef ?? undefined;
            } catch {
              // мусор вместо валидного JSON — просто нет атрибуции, не ошибка
            }
          }
        }
      }

      await this.clientsService.recordInboundMessage(channel.projectId, {
        tgUserId,
        tgUsername: user.username ?? undefined,
        tgFirstName: user.firstName ?? undefined,
        tgLastName: user.lastName ?? undefined,
        landingId,
        buyerId,
        // Правка 2026-07-21 (запрос пользователя: "не нужно ставить фейковые заглушки... если
        // это personal dm то никаких подписчиков нет получается") — раньше PERSONAL_DM был
        // исключением, где первое сообщение в личку СЧИТАЛОСЬ подпиской (subscribedAt), потому
        // что для этого режима нет отдельного события подписки. Пользователь указал: у этого
        // режима подписчиков в принципе не существует — есть только диалог, и статистика/
        // воронка (Subscribe-стадия считается по Client.subscribedAt) не должна показывать
        // несуществующее событие. Теперь ЛИЧНЫЙ АККАУНТ никогда не ставит subscribedAt ни для
        // одного режима канала — только диалог (firstDialogueAt/lastDialogueAt/
        // dialogueMessageCount, см. viaBot: false ниже), реальная подписка (если она вообще
        // возможна для этого режима) остаётся только за её настоящим механизмом
        // (handleJoinRequest/handleChatMemberUpdate в TelegramProvider).
        treatAsSubscriber: false,
        // viaBot: false — это личный MTProto-аккаунт, не бот. Пуши отправляются только через
        // Bot API (ChannelsService.sendMessage → TelegramProvider), у которого с этим
        // клиентом чата может вообще не быть — считать его "активировавшим бота" и включать
        // в аудиторию пушей неверно (баг-репорт 2026-07-17: массовые "chat not found").
        viaBot: false,
      });
    } catch (error) {
      this.logger.warn(`handleIncomingMessage failed for channel ${channel.id}: ${(error as Error).message}`);
    }
  }
}
