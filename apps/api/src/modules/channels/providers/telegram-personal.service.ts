import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '@prisma/client';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { FloodWaitError, RPCError, SlowModeWaitError } from 'telegram/errors';
import { Button } from 'telegram/tl/custom/button';
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

// Кеш живого списка диалогов (запрос-инцидент 2026-08-13: аккаунт с 7500+ диалогами — каждый
// client.getDialogs({}) без лимита ловит жёсткий Telegram-side flood-wait на несколько минут
// суммарно, и это раньше вызывалось заново на КАЖДЫЙ чих фильтра в PersonalBroadcastsService,
// т.е. многократно за один сеанс редактирования одной рассылки — сам по себе риск бана за
// спам-паттерн доступа, вдобавок к тому что превышает nginx proxy_read_timeout). Список диалогов
// не зависит от фильтра рассылки — кешируем результат по каналу на TTL, все фильтр-превью внутри
// одного захода бьют по одному кешу вместо N живых походов в Telegram.
const DIALOGS_CACHE_TTL_MS = 5 * 60 * 1000;
type DialogEntry = { tgUserId: string; firstName?: string; lastName?: string; username?: string; lastMessageAt?: Date };

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
  private dialogsCache = new Map<string, { data: DialogEntry[]; fetchedAt: number }>();
  private dialogsInFlight = new Map<string, Promise<DialogEntry[]>>();

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
      // Логируем всегда (запрос пользователя 2026-08-07: "логировать все ошибки от тг, если
      // этого ещё нет") — ошибка и так долетает до пользователя через исключение ниже, но без
      // строки в логе не остаётся следа для последующего разбора (например FloodWait на
      // SendCode после недавнего LogOut — ровно то, что произошло вживую с этим сервисом).
      this.logger.warn(`startConnect (sendCode) failed for channel ${channel.id}, phone ${phone}: ${(error as Error).message}`);
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
      this.logger.warn(`submitCode (SignIn) failed for channel ${channel.id}: ${(error as Error).message}`);
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
    } catch (error) {
      this.logger.warn(`submitPassword (2FA) failed for channel ${channel.id}: ${(error as Error).message}`);
      this.pending.delete(channel.id);
      throw new BadRequestException('Неверный пароль двухфакторной аутентификации, начните заново');
    }

    await this.finalizeConnection(channel, attempt);
  }

  // reason (запрос пользователя 2026-08-06: "проверять раз в некоторое время... уведомление и
  // изменение статуса") — только для АВТОМАТИЧЕСКОГО отключения при обнаружении мёртвой сессии
  // (handleDeadSession/checkSessionHealth ниже). Ручной вызов (кнопка в настройках, каскад
  // ProjectsService.archive()) передаёт reason не указывая — tgPersonalLastError остаётся/
  // становится null, это осознанное действие пользователя, а не ошибка, о которой нужно уведомлять.
  async disconnect(channel: Channel, reason?: string): Promise<void> {
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
      data: { tgPersonalPhone: null, tgPersonalUserId: null, tgSessionEncrypted: null, tgPersonalLastError: reason ?? null },
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

  // Живая сессия может быть отозвана НЕ нами (запрос пользователя 2026-08-06, диагностика
  // реального инцидента — проект Maria Lopez: "открываю список папок, а там нет папок" оказался
  // не багом фильтрации папок, а мёртвой сессией — пользователь сам завершил её в приложении
  // Telegram, "Активные сеансы", либо Telegram отозвал её сама). До этого метода такая ошибка
  // тонула в bare catch { return [] } без единого предупреждения в логах — снаружи выглядело
  // неотличимо от "у аккаунта реально нет папок/диалогов". Теперь любой вызывающий метод здесь
  // (getDialogFilters/getFolderTgUserIds/getAllDialogs/sendDirectMessage) при этой ошибке зовёт
  // disconnect() — тот же метод, что и ручное отключение из настроек: чистит tgSessionEncrypted и
  // т.д., из-за чего уже существующий индикатор "личный аккаунт не подключён" в UI подхватывает
  // это само, без отдельной новой плашки.
  private isDeadSessionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|USER_DEACTIVATED/.test(message);
  }

  private async handleDeadSession(channel: Channel, error: unknown): Promise<void> {
    if (!this.isDeadSessionError(error)) return;
    this.logger.warn(
      `Личный аккаунт канала ${channel.id} отключён на стороне Telegram (сессия недействительна) — очищаем подключение, требуется переподключение: ${(error as Error).message}`,
    );
    await this.disconnect(channel, 'Сессия отозвана Telegram — переподключите личный аккаунт');
  }

  // Проактивная проверка живости (запрос пользователя 2026-08-06: "чтобы как-то проверялось раз
  // в некоторое время... уведомление и изменение статуса, не тратить сильно ресурсы") — раньше
  // мёртвая сессия обнаруживалась только РЕАКТИВНО, когда какая-то другая операция (папки,
  // рассылка) случайно на неё натыкалась — между реальным отзывом сессии и обнаружением могло
  // пройти сколько угодно, если проектом никто не пользовался. client.getMe() — тот же самый
  // вызов, что уже используется здесь один раз в finalizeConnection сразу после входа, это
  // самый дешёвый авторизованный MTProto-запрос (никого не перечисляет, не грузит медиа) — им же
  // здесь и пингуем. Вызывается из TelegramPersonalHealthCron.
  async checkSessionHealth(channel: Channel): Promise<boolean> {
    try {
      const client = await this.getLiveClient(channel);
      if (!client) return false;
      await client.getMe();
      return true;
    } catch (error) {
      this.logger.warn(`checkSessionHealth failed for channel ${channel.id}: ${(error as Error).message}`);
      await this.handleDeadSession(channel, error);
      return false;
    }
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
    // getLiveClient — ВНУТРИ try (запрос пользователя 2026-08-07, "логировать все ошибки от
    // тг") — раньше стоял снаружи: если startListening/client.connect() бросает (например
    // сессия недействительна), ошибка улетала наружу совсем необработанной, минуя и лог, и
    // handleDeadSession.
    try {
      const client = await this.getLiveClient(channel);
      if (!client) return { success: false, error: 'Личный аккаунт не подключён или недоступен' };

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
      this.logger.warn(`sendStory failed for channel ${channel.id}: ${(error as Error).message}`);
      await this.handleDeadSession(channel, error);
      return { success: false, error: (error as Error).message };
    }
  }

  // Папки Telegram (запрос пользователя 2026-08-06, рассылка с личного аккаунта: "даже
  // похорошему по папкам которые уже созданы в телеграме") — сырой MTProto-вызов, GramJS не
  // даёт готовой обёртки, тот же приём, что уже используется здесь для Api.stories.SendStory.
  // Без кеша в БД — папки живые на стороне Telegram, фетчатся заново при каждом открытии формы
  // создания рассылки.
  //
  // ИСПРАВЛЕНО 2026-08-06 (баг-репорт: "открываю список папок, а там нет папок, но они есть в
  // телеграме", проект Maria Lopez): первая версия принимала только className==='DialogFilter',
  // отбрасывая ВСЕ 'DialogFilterChatlist' (папки, добавленные по shared-ссылке t.me/addlist/...,
  // а не созданные вручную "New Folder") — у этого аккаунта, судя по всему, папки именно такие.
  // DialogFilterChatlist структурно несёт те же title/includePeers, что и обычный DialogFilter
  // (проверено по TL-схеме telegram@2.26.22), поэтому оба типа теперь принимаются одинаково.
  // DialogFilterDefault ("Все чаты") по-прежнему исключён — у него нет includePeers вообще.
  async getDialogFilters(channel: Channel): Promise<{ id: number; title: string }[]> {
    // getLiveClient/invoke могут бросить (протухшая сессия, обрыв соединения) — по тому же
    // приёму "никогда не бросает наружу", что sendStory/sendDirectMessage: недоступность папок
    // не должна валить previewAudience/create целиком, деградируем до пустого списка. Но, в
    // отличие от того приёма, теперь ЛОГИРУЕМ причину (баг выше был невидим в логах вообще —
    // bare catch без единого warn, при живом протухании сессии выглядело неотличимо от "у
    // аккаунта реально нет папок").
    try {
      const client = await this.getLiveClient(channel);
      if (!client) return [];
      const result = await client.invoke(new Api.messages.GetDialogFilters());
      return result.filters
        .filter((f): f is Api.DialogFilter | Api.DialogFilterChatlist => f.className === 'DialogFilter' || f.className === 'DialogFilterChatlist')
        .map((f) => ({ id: f.id, title: f.title.text }));
    } catch (error) {
      this.logger.warn(`getDialogFilters failed for channel ${channel.id}: ${(error as Error).message}`);
      await this.handleDeadSession(channel, error);
      return [];
    }
  }

  // Явное членство в папке (includePeers) — запрос пользователя формулировал это как "даже
  // похорошему", т.е. best-effort: правило-based категории папки (contacts/groups/bots/...)
  // сознательно НЕ резолвятся — GramJS не отдаёт "кто попадает под правило" напрямую, это
  // потребовало бы кросс-сверки с полным списком диалогов аккаунта на каждый вызов. Покрывает
  // обычный случай "руками раскидал контакты по папкам", что и является типичным использованием.
  // Тот же фикс с DialogFilterChatlist, что и в getDialogFilters выше — иначе папка могла бы
  // появиться в списке (после фикса там), но здесь по-прежнему резолвилась бы в пустой список.
  async getFolderTgUserIds(channel: Channel, folderId: number): Promise<string[]> {
    try {
      const client = await this.getLiveClient(channel);
      if (!client) return [];

      const result = await client.invoke(new Api.messages.GetDialogFilters());
      const filter = result.filters.find(
        (f): f is Api.DialogFilter | Api.DialogFilterChatlist =>
          (f.className === 'DialogFilter' || f.className === 'DialogFilterChatlist') && f.id === folderId,
      );
      if (!filter) return [];

      return filter.includePeers.filter((p): p is Api.InputPeerUser => p.className === 'InputPeerUser').map((p) => String(p.userId));
    } catch (error) {
      this.logger.warn(`getFolderTgUserIds failed for channel ${channel.id}, folder ${folderId}: ${(error as Error).message}`);
      await this.handleDeadSession(channel, error);
      return [];
    }
  }

  // Полный живой список диалогов аккаунта (запрос пользователя 2026-08-06: "не только клиентов
  // пришедших через нашу срм, но и всех остальных, даже внешних, все абсолютно чаты должны
  // пушится") — раньше аудитория рассылки с личного аккаунта была ограничена строкой Client с
  // dialogueSource='PERSONAL_ACCOUNT' (см. PersonalBroadcastsService), т.е. только теми, кого
  // наша CRM уже успела создать как клиента. Реальных диалогов у аккаунта в Telegram может быть
  // (и обычно есть) больше — люди, написавшие ДО подключения личного аккаунта к CRM, добавленные
  // руками контакты, и т.д. client.getDialogs() — единственный способ увидеть их: только 1:1
  // диалоги с пользователями (isUser), боты и сам аккаунт (self) исключены — рассылка не имеет
  // смысла ни для того, ни для другого. limit не задан — тянем весь список (GramJS сам делает
  // постранично, с паузами при FloodWait).
  // Кеш с TTL + дедупликация параллельных вызовов (см. DIALOGS_CACHE_TTL_MS выше) — на холодном
  // кеше всё ещё может занять несколько минут для аккаунта с тысячами диалогов (Telegram сам
  // решает, сколько ждать flood-wait), но за это время в кеш не улетает вторая live-попытка:
  // все параллельные вызовы (например несколько правок фильтра подряд) ждут один и тот же
  // in-flight промис вместо N отдельных походов в Telegram.
  async getAllDialogs(channel: Channel, opts?: { forceRefresh?: boolean }): Promise<DialogEntry[]> {
    const cached = this.dialogsCache.get(channel.id);
    if (!opts?.forceRefresh && cached && Date.now() - cached.fetchedAt < DIALOGS_CACHE_TTL_MS) {
      return cached.data;
    }

    const inFlight = this.dialogsInFlight.get(channel.id);
    if (inFlight) return inFlight;

    const promise = this.fetchAllDialogsLive(channel).finally(() => this.dialogsInFlight.delete(channel.id));
    this.dialogsInFlight.set(channel.id, promise);
    return promise;
  }

  // Прогрев кеша без блокировки вызывающей стороны (запрос-инцидент 2026-08-13) — вызывается при
  // открытии формы создания рассылки (GET .../folders, тот же момент, что и раньше), чтобы к
  // моменту, когда пользователь дойдёт до фильтров (дебаунс 500мс в UI), холодный ~2-минутный
  // фетч для больших аккаунтов уже был в процессе/готов, а не стартовал только на первый
  // preview-audience и упирался в таймаут nginx.
  prewarmDialogsCache(channel: Channel): void {
    const cached = this.dialogsCache.get(channel.id);
    if (cached && Date.now() - cached.fetchedAt < DIALOGS_CACHE_TTL_MS) return;
    if (this.dialogsInFlight.has(channel.id)) return;
    this.getAllDialogs(channel).catch(() => undefined);
  }

  private async fetchAllDialogsLive(channel: Channel): Promise<DialogEntry[]> {
    try {
      const client = await this.getLiveClient(channel);
      if (!client) return [];

      const dialogs = await client.getDialogs({});
      const result: DialogEntry[] = [];
      for (const d of dialogs) {
        if (!d.isUser || !d.entity || d.entity.className !== 'User') continue;
        const user = d.entity;
        if (user.bot || user.self) continue;
        result.push({
          tgUserId: user.id.toString(),
          firstName: user.firstName ?? undefined,
          lastName: user.lastName ?? undefined,
          username: user.username ?? undefined,
          lastMessageAt: d.date ? new Date(d.date * 1000) : undefined,
        });
      }
      this.dialogsCache.set(channel.id, { data: result, fetchedAt: Date.now() });
      return result;
    } catch (error) {
      this.logger.warn(`getAllDialogs failed for channel ${channel.id}: ${(error as Error).message}`);
      await this.handleDeadSession(channel, error);
      return [];
    }
  }

  // Отправка рассылки через личный аккаунт (запрос пользователя 2026-08-06, модуль
  // personal-broadcasts) — тот же try/catch → {success, error} паттерн, что sendStory выше,
  // никогда не бросает наружу (процессор рассылки не должен падать из-за одного получателя).
  // client.getInputEntity — и есть "живая проверка, что диалог реально существует прямо
  // сейчас" (явный запрос пользователя): если GramJS не может резолвить пира по tgUserId
  // (аккаунт никогда не видел этого пользователя или потерял его из кэша сущностей), значит
  // отправлять там нечему — падает в тот же catch, вызывающая сторона помечает как "skipped".
  // FloodWaitError/SlowModeWaitError — отдельная ветка, чтобы процессор мог поспать РОВНО
  // столько, сколько просит сам Telegram, а не свою обычную паузу между получателями.
  async sendDirectMessage(
    channel: Channel,
    tgUserId: string,
    params: { text: string; mediaUrl?: string; buttons?: { text: string; url?: string }[] },
  ): Promise<{ success: boolean; error?: string; floodWaitSeconds?: number }> {
    // getLiveClient — ВНУТРИ try, тот же фикс, что и у sendStory выше (запрос пользователя
    // 2026-08-07: "логировать все ошибки от тг, если этого ещё нет").
    try {
      const client = await this.getLiveClient(channel);
      if (!client) return { success: false, error: 'Личный аккаунт не подключён или недоступен' };

      const entity = await client.getInputEntity(Number(tgUserId));
      const buttons = params.buttons?.filter((b) => b.url).map((b) => [Button.url(b.text, b.url)]);

      await client.sendMessage(entity, {
        message: params.text,
        ...(params.mediaUrl ? { file: params.mediaUrl } : {}),
        ...(buttons?.length ? { buttons } : {}),
      });

      return { success: true };
    } catch (error) {
      if (error instanceof FloodWaitError || error instanceof SlowModeWaitError) {
        // FloodWait уже логируется вызывающей стороной (PersonalBroadcastsProcessor.logger.warn,
        // с указанием broadcastId) — не дублируем здесь тем же уровнем.
        return { success: false, error: error.message, floodWaitSeconds: error.seconds };
      }
      this.logger.warn(`sendDirectMessage failed for channel ${channel.id}, tgUserId ${tgUserId}: ${(error as Error).message}`);
      await this.handleDeadSession(channel, error);
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
    const tgUserId = String(me.id);

    // Один и тот же личный Telegram-аккаунт не должен иметь больше одной живой сессии с этого
    // сервера одновременно — даже в другой компании (запрос пользователя 2026-08-07, после
    // реального инцидента: параллельные MTProto-соединения под одним аккаунтом из разных
    // процессов привели к нестабильности и вынужденным отключениям). Тот же класс проблемы, что
    // уже чинили для повторного использования бот-токена между проектами (см.
    // feedback_archived_project_webhook_hijack) — там конфликтовал вебхук, здесь конфликтовало
    // бы MTProto-соединение. Ищем по ВСЕЙ таблице Channel, без companyId — намеренно, аккаунт
    // может физически принадлежать другой компании. id: {not: channel.id} — переподключение
    // ТОГО ЖЕ канала к тому же аккаунту (например, после протухшей сессии) остаётся разрешено.
    const conflicting = await this.prisma.channel.findFirst({
      where: { tgPersonalUserId: tgUserId, tgSessionEncrypted: { not: null }, id: { not: channel.id } },
      include: { project: { select: { name: true } } },
    });
    if (conflicting) {
      await attempt.client.destroy();
      throw new BadRequestException(
        `Этот Telegram-аккаунт уже подключён к другому проекту («${conflicting.project.name}») — сначала отключите его там, прежде чем подключать здесь.`,
      );
    }

    const sessionString = (attempt.client.session as StringSession).save() as unknown as string;

    await this.prisma.channel.update({
      where: { id: channel.id },
      data: {
        tgPersonalPhone: attempt.phone,
        tgPersonalUserId: tgUserId,
        tgSessionEncrypted: this.encryption.encrypt(sessionString),
        // Свежий успешный вход сбрасывает прошлую пометку "сессию отозвал Telegram" (если она
        // была) — новая сессия ни при чём.
        tgPersonalLastError: null,
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
      let abTestGroupId: string | undefined;
      let buyerId: string | undefined;

      // Атрибуция лендинга — только на первом сообщении (см. telegram-link.util.ts &text=,
      // "честное ограничение": код виден и может быть стёрт до отправки). Метка баера
      // (Фаза 3.6) — из того же блока, тем же путём, что и landingId. abTestGroupId (запрос
      // пользователя 2026-08-20) — тот же мост, задан только если заход пришёл через сплит
      // группы (см. LandingRendererService.injectTrackingScripts).
      if (!existingClient) {
        const text = event.message.text?.trim();
        if (text) {
          const cached = await this.redis.get(`start:${text}`);
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              landingId = parsed.landingId ?? undefined;
              abTestGroupId = parsed.abTestGroupId ?? undefined;
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
        abTestGroupId,
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
