# 05 — Backend Channels: Telegram, WhatsApp, Instagram, Viber

## Задача для Claude Code
Реализуй абстрактный слой каналов с провайдерами.

## Channel Provider Interface

```typescript
// modules/channels/providers/channel.provider.interface.ts

export interface SendMessageOptions {
  text: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video' | 'document';
  buttons?: Array<{ text: string; url?: string; callbackData?: string }>;
  parseMode?: 'HTML' | 'Markdown';
}

export interface BroadcastResult {
  totalSent: number;
  totalFailed: number;
  failedUserIds: string[];
}

export interface UserStatus {
  isReachable: boolean;  // можно отправить сообщение
  isSubscribed: boolean; // состоит в канале/списке
}

export interface ChannelProvider {
  // Инициализация (регистрация webhook и т.д.)
  initialize(channel: Channel): Promise<void>;
  
  // Отправить сообщение одному пользователю
  sendMessage(channelUserId: string, options: SendMessageOptions): Promise<boolean>;
  
  // Получить статус пользователя
  getUserStatus(channelUserId: string): Promise<UserStatus>;
  
  // Одобрить вступление (для Telegram)
  approveJoinRequest?(userId: string): Promise<void>;
  
  // Отклонить вступление
  declineJoinRequest?(userId: string): Promise<void>;
  
  // Получить информацию о пользователе
  getUserInfo?(channelUserId: string): Promise<Partial<Client>>;
}
```

## Telegram Provider — доработано 2026-06-28 (реальный баг + два запрошенных поведения)

Пользователь сообщил реальный баг: добавил канал с реальным ботом, получил просто "Telegram
Отключён" без единой подсказки почему. Причина — `setWebhook` требует HTTPS-URL, а в этой
песочнице `API_URL` обычный HTTP; `initialize()` бросал исключение, `ChannelsService.create`
ловил его и деактивировал канал, но причину никуда не записывал — пользователь не мог понять,
истёкший токен это, не-админ бот, или инфраструктурная проблема с HTTPS.

Что изменилось относительно псевдокода ниже:

1. **`Channel.lastError String?`** (новая колонка, миграция `20260628160000_channel_last_error`) —
   реальная причина последней деактивации (из `initialize()` либо health-check), показывается в UI
   рядом с "Отключён" вместо немой надписи. Очищается при успешном `initialize()`.
2. **Проверка админства бота — сразу при подключении**, не дожидаясь health-check cron: после
   `bot.init()`, если указан `tgChannelId`, реальный `getChatMember(tgChannelId, bot.botInfo.id)`,
   и если статус не `administrator`/`creator` — явная ошибка "Бот не является администратором
   канала", сразу попадающая в `lastError`.
3. **`POST /channels/:id/reactivate`** — повторная попытка `initialize()` без пересоздания канала
   (частый кейс: бот добавлен раньше, чем стал админом — чинится в Telegram, не в форме канала).
   Кнопка "Переподключить" в UI рядом с неактивным каналом.
4. **Новый обработчик `chat_member`** (НЕ `my_chat_member`, который только про статус самого
   бота) — покрывает обычное вступление в публичный канал/группу, где approval не требуется
   (там `chat_join_request` вообще не присылается). Требует, чтобы бот был админом, И явного
   `allowed_updates` в `setWebhook` — `chat_member` НЕ входит в дефолтный набор Telegram (вместе с
   `message_reaction`/`message_reaction_count`), подтверждено по core.telegram.org. Переход
   `left/kicked → member/administrator/creator` — `findOrCreate` + `Subscribe`-событие; обратный
   переход — `markUnsubscribed`. Обновления статуса самого бота (`user.is_bot`) явно
   пропускаются — для них уже есть `my_chat_member`.
5. **Лендинг всегда ведёт на самый недавно подключённый активный Telegram-канал проекта** —
   `LandingRendererService`'s `channels` include и `ChannelsService.sendMessage`'s `findFirst`
   получили `orderBy: { createdAt: 'desc' }`. Раньше порядок при `take:1` был не гарантирован —
   добавление второго Telegram-канала могло НЕ переключить лендинг/пуши на него.

**Что проверено живым тестом:** `lastError`/`reactivate` — на WhatsApp-канале с заведомо неверным
токеном (тот же код путь, что у Telegram) — `lastError` содержит реальное сообщение 360dialog,
`reactivate` после смены токена через `PATCH` корректно перезапускает `initialize()` с новым
значением; UI показывает текст ошибки и кнопку "Переподключить" (скриншот, без ошибок консоли).
`chat_member`-логика — вызвана напрямую (`NestFactory.createApplicationContext`, как и для
Instagram) с синтетическими апдейтами: вступление создало `Client`+`Subscribe`-событие, выход
корректно пометил `isSubscribed:false`, апдейт статуса самого бота — проигнорирован. Порядок
каналов для лендинга — два Telegram-канала вставлены напрямую в БД с разными `createdAt`,
`renderPreviewHtml` до и после добавления второго канала корректно переключил `BOT_USERNAME` в
deep-link на новый канал. **Не проверено живьём**: проверка админства и `setWebhook` с реальным
ботом/каналом — нужен реальный токен Telegram-бота и доступ сделать его админом тестового канала,
которых нет в этой песочнице (пользователь предпочёл синтетический тест).

## 4 режима Telegram-лендинга (2026-06-29)

Пользователь явно запросил гибкую настройку того, куда ведёт кнопка "Вступить" на лендинге —
до этого лендинг ВСЕГДА вёл на бота (deep-link `t.me/<bot>?start=<code>`), независимо от того,
был ли у канала настроен приватный join-request flow или вообще не было канала. Добавлен
`Channel.tgMode` (enum `TelegramMode`, миграция `20260629170000_telegram_landing_modes`),
определяющий и куда ведёт кнопка, и какой механизм подписки работает на бэкенде:

1. **`BOT_DIRECT`** (дефолт, сохраняет прежнее поведение) — кнопка открывает чат с ботом,
   `/start` фиксирует атрибуцию (fbclid/UTM из Redis `start:<code>`) и общение продолжается
   прямо в боте. Канал необязателен.
2. **`PRIVATE_CHANNEL_REQUEST`** — кнопка **тоже** ведёт на бота (не на канал напрямую!) — это
   осознанное решение: у invite-ссылок Telegram-каналов нет query-параметров, прямая ссылка с
   лендинга на канал убила бы атрибуцию полностью. Вместо этого `TelegramProvider.initialize()`
   один раз создаёт `bot.api.createChatInviteLink(tgChannelId, {creates_join_request:true})` и
   кэширует её в новом поле `Channel.tgInviteLink`; `handleStart` (после фиксации атрибуции) шлёт
   пользователю кнопку с этой ссылкой — клик по ней даёт нативный Telegram "Request to Join",
   который дальше одобряет уже существующий `handleJoinRequest`. `tgChannelId` обязателен для
   этого режима, бот должен быть админом канала (та же проверка, что и раньше).
3. **`PUBLIC_CHANNEL_DIRECT`** — кнопка ведёт **прямо на канал** (`https://t.me/<tgChannelUsername>`),
   без захода в бота вообще — один клик для пользователя, но атрибуция по клику слабее (нет
   fbclid/UTM на момент вступления, только серверное `chat_member`-событие с `tgUserId`).
   `tgChannelId` (для проверки админства/трекинга) и `tgChannelUsername` (для самой ссылки)
   оба обязательны.
4. **`PERSONAL_DM`** — кнопка ведёт на `https://t.me/<tgPersonalUsername>` — личный аккаунт,
   НЕ бот. `TelegramProvider.initialize()` для этого режима — no-op (только проверяет, что
   username указан): нет токена, нет вебхука, нет API-вызовов. Из этого следует жёсткое
   ограничение, явно показанное в UI: подписчики НЕ попадают в CRM (Telegram не даёт ботам
   видеть переписку личных аккаунтов), пуши через этот "канал" невозможны — единственная
   аналитика это клиентский `Lead`-трекинг в момент клика, до перехода.

**`LandingRendererService.buildTelegramLink(channel)`** — вычисляет `{url, isBotMediated}` по
`tgMode`: режимы 1-2 дают `isBotMediated:true` (рисуется `data-tg-bot` в шаблоне, SDK
перехватывает клик и подставляет свежий start-код), 3-4 — `isBotMediated:false` (`data-tg-bot`
пустой, ссылка отдаётся как обычный `<a href target="_blank">`, без лишнего async-запроса перед
переходом). Шаблоны (`minimal`/`gradient`/`dark`) используют `{{TG_LINK}}` вместо хардкода
`https://t.me/{{BOT_USERNAME}}?start={{START_CODE}}`. `apps/sdk/src/browser.ts` обновлён: убран
fallback-матчинг по `[href*="t.me"]` (раньше пытался переписать ЛЮБУЮ t.me-ссылку как боtовую,
включая прямые ссылки на канал/личку, для которых `?start=` не имеет смысла) — теперь перехват
работает только при явном непустом `data-tg-bot`.

**`ChannelsService.update`** теперь вызывает `tryInitialize` повторно после `PATCH` (раньше
просто писал в БД без эффекта) — иначе смена `tgMode`/`tgChannelUsername` не доходила бы до
реального бота/invite-ссылки до следующего полного `reactivate`. **`checkTelegramHealth`**
получил спецветку для `PERSONAL_DM` (нет бота — нечего проверять через `getMe`/`getChatMember`,
иначе health-check cron каждые 15 минут ошибочно деактивировал бы канал).

**Проверено:** TypeScript-компиляция backend+frontend чистая; regression-тест на реальном
`jcywkdake.shop` подтвердил, что режим `BOT_DIRECT` продолжает работать без изменений (deep-link
на бота со свежим start-кодом, как и раньше); логика `buildTelegramLink` для всех 4 веток
проверена изолированным запуском (юзернеймы корректно очищаются от `@`, бот-режимы дают
одинаковый `t.me/<bot>?start={{START_CODE}}`, прямые режимы — статичную ссылку без start).
**Не проверено живым кликом в реальном Telegram**: создание invite-ссылки приватного канала,
admin-проверка для `PUBLIC_CHANNEL_DIRECT`, и сам факт вступления через `PERSONAL_DM`/публичный
канал — это требует реального бота+канала, пользователь решил не мутировать свой живой
тестовый канал ради проверки и протестирует остальные 3 режима сам, когда понадобится.

## Редактирование канала + метаданные из Telegram в карточке (2026-06-29, тот же день)

Два запроса пользователя сразу после 4 режимов: (1) раньше канал можно было только создать
или удалить — не отредактировать (бэкенд `PATCH /channels/:id` существовал, но в UI кнопки не
было); (2) после подключения карточка канала должна сама показать название/айди/фото/число
участников из Telegram, а не только то, что пользователь ввёл руками, плюс для ботов — токен
(с возможностью раскрыть).

1. **Метаданные** — новые поля `Channel.tgBotId`/`tgBotFirstName`/`tgChannelTitle`/
   `tgChannelMembersCount`/`tgAvatarFileId` (миграция `20260629180000_telegram_metadata`).
   `TelegramProvider.fetchAndSaveMetadata()` вызывается в конце `initialize()` (после admin-check
   и invite-ссылки, перед `setWebhook`) — `getChat(tgChannelId)` за название/фото/`getChatMemberCount`,
   фото бота (`getChat(bot.botInfo.id)`) как fallback, если у канала фото нет или канала нет
   вообще (BOT_DIRECT). Обёрнуто в свой try/catch с `logger.warn` — ошибка получения метаданных
   не должна ронять initialize() целиком, бот уже рабочий к этому моменту. **Для PERSONAL_DM
   метаданных нет и не может быть** — Bot API не даёт способа узнать что-либо о личном аккаунте,
   с которым бот никогда не взаимодействовал (нет бота вообще в этом режиме).
2. **`GET /channels/:id/avatar`** — стримит байты фото сам, а не отдаёт прямую ссылку Telegram
   (`api.telegram.org/file/bot<TOKEN>/<path>` содержит токен бота в URL — отдать её клиенту
   значило бы раскрыть секрет). `ChannelsService.streamAvatar`: `bot.api.getFile(tgAvatarFileId)`
   → `fetch()` файла → стрим байт с правильным `Content-Type`.
3. **Раскрытие токена при редактировании**: `GET /channels/:id` (уже существовал) возвращает
   канал целиком, включая `tgBotToken`/`wa360Token`/`igAccessToken` — это нормально, доступ
   и так скоупится по `companyId` через `project.companyId`. Специально НЕ включено в список
   каналов проекта (`GET /projects/:id` — `select` без секретных полей) — секреты подтягиваются
   только по явному запросу на редактирование, не в массовом списке.
4. **Переинициализация при PATCH уже была добавлена для 4 режимов** (`ChannelsService.update`
   → `tryInitialize`) — она же автоматически подхватывает метаданные при каждом сохранении формы
   редактирования, отдельного механизма не потребовалось.

**Проверено:** прямой вызов `channelsService.reactivate()` на реальном живом канале (`testchanel_bot`/
`newCH`, тот самый канал из live-теста 4 режимов) — метаданные подтянулись верно
(`tgBotFirstName: "testchanel_bot"`, `tgChannelTitle: "newCH"`, `tgChannelMembersCount: 5`,
`tgAvatarFileId: null` — у тестового канала фото и не было, ожидаемо). Первый прогон сразу
после рестарта API упал на `setWebhook` (`429 Too Many Requests` — Telegram временно
зарейтлимитил повторный `setWebhook` с тем же URL) и канал на секунду стал `isActive:false`;
повторный вызов через несколько секунд прошёл штатно, `isActive:true`. TS-компиляция api+web
чистая, ESLint — без ошибок (один ожидаемый warning про `<img>` вместо `next/image`, для
blob-URL аватарок `next/image` не годится). **Не проверено**: реальный аватар канала с
настоящим фото (тестовый канал без фото) — логика прокси-эндпоинта проверена только на
401-ответе без токена (auth guard работает), не на реальном файле.

### Баг редактирования канала: "ошибка валидации" при смене режима (2026-06-29, тот же день)

Пользователь сообщил: смена режима на "Приватный канал" при редактировании уже созданного
канала даёт ошибку валидации, при создании нового — нет. Реальная причина — не специфична для
этого режима: `channelFormToPayload` (общая функция и для создания, и для редактирования)
всегда включает поле `type`, а `UpdateChannelDto` (`PATCH /channels/:id`) его явно исключает
(`OmitType(CreateChannelDto, ['projectId', 'type'])` — тип канала не меняется после создания) —
и `ValidationPipe` в `main.ts` настроен с `forbidNonWhitelisted: true`, так что лишнее поле в
теле PATCH-запроса валит **весь** запрос 400-кой целиком, независимо от выбранного режима или
остальных полей. Это должно было ломать любое сохранение в диалоге редактирования — пользователь
просто заметил это именно на приватном канале. Исправлено: `channelFormToPayload` больше не
включает `type`, `addChannel` (POST, `CreateChannelDto` его принимает) добавляет `type` сам,
отдельно от общей функции.

```typescript
// modules/channels/providers/telegram.provider.ts
import { Bot, Context } from 'grammy';

@Injectable()
export class TelegramProvider implements ChannelProvider {
  private bots = new Map<string, Bot>(); // channelId -> Bot instance
  
  async initialize(channel: Channel): Promise<void> {
    if (!channel.tgBotToken) throw new Error('Bot token required');
    
    const bot = new Bot(channel.tgBotToken);
    
    // Обработка запросов на вступление
    bot.on('chat_join_request', async (ctx) => {
      await this.handleJoinRequest(ctx, channel);
    });
    
    // Обработка команд (для регистрации покупок)
    bot.command('start', async (ctx) => {
      await this.handleStart(ctx, channel);
    });
    
    bot.command('purchase', async (ctx) => {
      await this.handlePurchaseCommand(ctx, channel);
    });
    
    // Отслеживание ухода из канала
    bot.on('my_chat_member', async (ctx) => {
      await this.handleMemberUpdate(ctx, channel);
    });
    
    // Установить webhook
    const webhookUrl = `${process.env.API_URL}/api/v1/webhooks/telegram/${channel.id}`;
    await bot.api.setWebhook(webhookUrl);
    
    this.bots.set(channel.id, bot);
  }
  
  private async handleJoinRequest(ctx: Context, channel: Channel) {
    const tgUser = ctx.chatJoinRequest?.from;
    if (!tgUser) return;
    
    try {
      // 1. Найти или создать клиента в CRM
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
      
      // 2. Проверить лимит клиентов
      const canAdd = await this.subscriptionService.checkClientLimit(channel.projectId);
      
      if (!canAdd) {
        // Отклонить если лимит
        await ctx.api.declineChatJoinRequest(
          ctx.chatJoinRequest.chat.id,
          tgUser.id
        );
        return;
      }
      
      // 3. Одобрить вступление
      await ctx.api.approveChatJoinRequest(
        ctx.chatJoinRequest.chat.id,
        tgUser.id
      );
      
      // 4. Отправить приветственное сообщение если настроено
      if (channel.tgWelcomeMessage) {
        await this.sendMessage(String(tgUser.id), {
          text: channel.tgWelcomeMessage,
        });
      }
      
      // 5. Отправить событие Subscribe в очередь
      await this.trackingQueue.add('track-event', {
        projectId: channel.projectId,
        clientId: client.id,
        eventName: 'Subscribe',
        payload: {
          channelType: 'TELEGRAM',
          tgUserId: tgUser.id,
        }
      });
      
    } catch (error) {
      this.logger.error('Error handling join request', error);
    }
  }
  
  private async handleStart(ctx: Context, channel: Channel) {
    // Получить параметр start (содержит уникальный код связки с fbclid)
    const startParam = ctx.match as string;
    
    if (startParam) {
      // Найти fbclid по коду из Redis
      const trackingData = await this.redis.get(`start:${startParam}`);
      
      if (trackingData) {
        const { fbclid, ttclid, utmSource, utmCampaign } = JSON.parse(trackingData);
        
        // Обновить клиента с трекинг данными
        await this.clientsService.updateTracking(
          String(ctx.from?.id),
          channel.projectId,
          { fbclid, ttclid, utmSource, utmCampaign }
        );
        
        // Удалить из Redis (одноразовый)
        await this.redis.del(`start:${startParam}`);
      }
    }
  }
  
  async sendMessage(channelUserId: string, options: SendMessageOptions): Promise<boolean> {
    // Найти нужный бот по channelUserId
    // В реальной реализации нужно передавать channel ID
    // Упрощение: ищем через ProjectId в контексте
    
    try {
      const bot = this.getBot(/* channel */);
      
      if (options.mediaUrl && options.mediaType === 'photo') {
        await bot.api.sendPhoto(channelUserId, options.mediaUrl, {
          caption: options.text,
          parse_mode: options.parseMode || 'HTML',
          reply_markup: options.buttons ? {
            inline_keyboard: [options.buttons.map(b => ({
              text: b.text,
              url: b.url,
            }))]
          } : undefined,
        });
      } else {
        await bot.api.sendMessage(channelUserId, options.text, {
          parse_mode: options.parseMode || 'HTML',
          reply_markup: options.buttons ? {
            inline_keyboard: [options.buttons.map(b => ({
              text: b.text,
              url: b.url,
            }))]
          } : undefined,
        });
      }
      
      return true;
    } catch (error) {
      // Если 403 Forbidden — пользователь заблокировал бота
      if (error.error_code === 403) {
        await this.clientsService.markBotBlocked(channelUserId);
      }
      return false;
    }
  }
  
  async getUserStatus(channelUserId: string): Promise<UserStatus> {
    try {
      // Попробовать отправить "пустой" запрос для проверки
      // Реально — проверяем через getChatMember
      return { isReachable: true, isSubscribed: true };
    } catch {
      return { isReachable: false, isSubscribed: false };
    }
  }
  
  // Обработка вебхука (вызывается из WebhooksController)
  async handleWebhook(channelId: string, update: any): Promise<void> {
    const bot = this.bots.get(channelId);
    if (bot) {
      await bot.handleUpdate(update);
    }
  }
}
```

## WhatsApp Provider — ✅ РЕАЛИЗОВАНО (Фаза 2, шаг 2.1, 2026-06-27)

Реальная реализация: `apps/api/src/modules/channels/providers/whatsapp.provider.ts`.

**Через 360dialog (BSP), не напрямую через Meta Graph API.** 00_MASTER_OVERVIEW.md
зафиксировал стек как "WhatsApp Cloud API (Meta) через 360dialog" — на практике это значит
другой base URL/заголовок авторизации, чем у прямого подключения к Meta:

- Endpoint отправки: `POST https://waba-v2.360dialog.io/messages` (без `phone_number_id`
  в пути — в отличие от прямого Meta Cloud API), заголовок `D360-API-KEY: <wa360Token>`.
  Формат `messaging_product`/`to`/`type`/`text`/`interactive` идентичен Meta Cloud API,
  так как 360dialog проксирует ту же инфраструктуру.
- Регистрация webhook: `POST https://waba-v2.360dialog.io/v1/configs/webhook` с телом
  `{ url, headers: { Authorization: "Basic base64(user:pass)" } }` — в отличие от Telegram,
  это реальный API-вызов, а не разовая настройка в личном кабинете.
- **Безопасность вебхука: только Basic Auth.** У 360dialog (в отличие от Meta при прямом
  подключении) нет HMAC-подписи запроса. Поэтому `Channel.waWebhookUsername`/
  `waWebhookPassword` генерируются нами (`crypto.randomBytes`) при первом `initialize()` и
  передаются в `configs/webhook`, а `WhatsAppProvider.handleWebhook` сверяет заголовок
  `Authorization` на каждый входящий запрос.
- Источник: docs.360dialog.com, сверено на 2026-06-27 (не написано по памяти/предположению).

```typescript
// modules/channels/providers/whatsapp.provider.ts (сокращённо, полный код в репозитории)

@Injectable()
export class WhatsAppProvider implements ChannelProvider {
  private readonly baseUrl = 'https://waba-v2.360dialog.io';

  async initialize(channel: Channel): Promise<void> {
    if (!channel.wa360Token) throw new Error('360dialog API key (wa360Token) required');

    let { waWebhookUsername: username, waWebhookPassword: password } = channel;
    if (!username || !password) {
      username = crypto.randomBytes(8).toString('hex');
      password = crypto.randomBytes(16).toString('hex');
      await this.prisma.channel.update({ where: { id: channel.id }, data: { waWebhookUsername: username, waWebhookPassword: password } });
    }

    const webhookUrl = `${this.config.get('API_URL')}/api/v1/webhooks/whatsapp/${channel.id}`;
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

    const res = await fetch(`${this.baseUrl}/v1/configs/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'D360-API-KEY': channel.wa360Token },
      body: JSON.stringify({ url: webhookUrl, headers: { Authorization: `Basic ${basicAuth}` } }),
    });
    if (!res.ok) throw new Error(`360dialog отказал в регистрации вебхука: ${res.status} ${await res.text()}`);
  }

  async sendMessage(channelUserId: string, options: SendMessageOptions, channel: Channel): Promise<boolean> {
    // POST {baseUrl}/messages, заголовок D360-API-KEY, payload text/interactive/media
    // в зависимости от options (см. полный код) — возвращает false без исключения при ошибке.
  }

  async getUserStatus(): Promise<UserStatus> {
    // 360dialog не даёт простой проверки достижимости — как и у Telegram, "доступен по
    // умолчанию" достаточно для текущей фазы.
    return { isReachable: true, isSubscribed: true };
  }

  // Вызывается из WebhooksController с заголовком Authorization из запроса.
  async handleWebhook(channelId: string, authHeader: string | undefined, payload: any): Promise<void> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel || channel.type !== 'WHATSAPP' || !channel.isActive) return;
    if (!this.verifyBasicAuth(channel, authHeader)) return; // невалидный/отсутствующий Authorization — тихо игнорируем

    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return; // статус-уведомление о доставке, не входящее сообщение

    const client = await this.clientsService.findOrCreate({
      projectId: channel.projectId,
      waPhone: message.from,
      waName: value.contacts?.[0]?.profile?.name,
      channelType: 'WHATSAPP',
      subscribedAt: new Date(),
    });

    await this.trackingService.recordEvent(channel.projectId, { eventName: 'Lead', clientId: client.id, source: 'SERVER' });
  }
}
```

**Что проверено живым тестом (2026-06-27, без реального WhatsApp-номера):**
- Создание канала с заведомо невалидным `wa360Token` → реальный HTTP-запрос к
  `waba-v2.360dialog.io`, реальный `401 Invalid api token`, `ChannelsService.create` корректно
  ловит ошибку и помечает канал `isActive: false` (как и у Telegram).
- Синтетический POST на `/webhooks/whatsapp/:channelId` без `Authorization` или с неверным
  Basic Auth → тихо игнорируется, клиент не создаётся.
- Тот же запрос с верным Basic Auth (сгенерированным при `initialize()`) → создаётся `Client`
  с `waPhone`/`waName`/`channelType: WHATSAPP`, пишется `TrackingEvent` с `eventName: 'Lead'`.
- `sendMessage`/`/channels/:id/test` с фейковым токеном → `{ sent: false }`, без падения процесса.
- Не проверено живьём (нет реального номера/360dialog-аккаунта): отправка реального сообщения,
  реальный сценарий `configs/webhook` с настоящим номером, доставка кнопок (`interactive`).
```

## Instagram Provider — ✅ РЕАЛИЗОВАНО (Фаза 2, шаг 2.6, 2026-06-28)

Реальный контракт сверен напрямую по developers.facebook.com на 2026-06-28 (Messenger Platform,
Page-connected flow) — псевдокод выше неверен в нескольких местах, не транскрибировался буквально:

- **Отправка** — не `${igPageId}/messages` с `Authorization: Bearer`, а
  `POST https://graph.facebook.com/v18.0/me/messages?access_token=<PAGE_ACCESS_TOKEN>`,
  токен в query-параметре, IGSID получателя — в теле (`recipient.id`), не в пути.
- **Вебхук — НЕ per-channel**, в отличие от Telegram/WhatsApp. Один URL на всё приложение
  (`POST /api/v1/webhooks/instagram`), настраивается один раз в Meta App Dashboard:
  - `GET /webhooks/instagram` — одноразовая верификация при подключении: Meta шлёт
    `hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`, нужно эхом вернуть
    `hub.challenge`, если `hub.verify_token` совпадает с нашим `META_WEBHOOK_VERIFY_TOKEN`.
  - `POST /webhooks/instagram` — подпись `X-Hub-Signature-256: sha256=<hmac>`, считается от
    СЫРЫХ байт тела с общим (не per-channel) `META_APP_SECRET`.
  - Раз вебхук общий, `InstagramProvider.handleWebhook(payload)` получает ВЕСЬ конверт
    (`{object:'instagram', entry:[...]}`, может содержать записи разных аккаунтов сразу) и сам
    резолвит `Channel` по `entry.id` — путаница в терминологии Meta: `entry.id` это **Instagram
    Business Account ID**, не Facebook Page ID (`igPageId`). Оба ID разные и оба нужны:
    `igPageId` — для подписки Page на вебхуки (`POST /{igPageId}/subscribed_apps?
    subscribed_fields=messages`), `igBusinessAccountId` — для матчинга входящих событий.
    `igBusinessAccountId` мы получаем сами в `initialize()` через
    `GET /{igPageId}?fields=instagram_business_account` и сохраняем — пользователь его не вводит.
- **Подписка Page на вебхуки — реальный runtime API-вызов** в `initialize()` (как у 360dialog),
  не разовая настройка только в дашборде — без него Meta не пришлёт ни одного события.
- `is_echo: true` в `message` — это копия СВОЕГО исходящего сообщения, не входящее; пропускается.

```typescript
// apps/api/src/modules/channels/providers/instagram.provider.ts (реальная сигнатура)
async initialize(channel: Channel): Promise<void> {
  // GET /{igPageId}?fields=instagram_business_account → сохранить igBusinessAccountId
  // POST /{igPageId}/subscribed_apps?subscribed_fields=messages → подписать Page
}

async sendMessage(igsid: string, options: SendMessageOptions, channel: Channel): Promise<boolean> {
  // POST https://graph.facebook.com/v18.0/me/messages?access_token=<token>
  // body: { recipient: { id: igsid }, message: { text } }
}

verifySignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean

async handleWebhook(payload: { object?: string; entry?: Array<{ id: string; messaging?: any[] }> }): Promise<void> {
  // для каждого entry — найти Channel по igBusinessAccountId, для каждого messaging без
  // is_echo — ClientsService.findOrCreate({igUserId}) + TrackingService.recordEvent('Lead')
}
```

**Generic-шаблон с кнопками не реализован** (требует отдельной структуры от той, что используют
Telegram/WhatsApp) — не было в исходном чеклисте этого шага, осознанно не строилось.

**Что проверено живым тестом:** создание канала с заведомо невалидным `igAccessToken` → реальный
HTTP-запрос к `graph.facebook.com`, реальный `400 Invalid OAuth access token`, `ChannelsService.
create` корректно ловит ошибку и помечает канал `isActive:false` (как у Telegram/WhatsApp);
`sendMessage`/`/channels/:id/test` с тем же фейковым токеном → реальный `400` от Graph API,
`{sent:false}`, без падения процесса. `verifySignature` — валидная/подделанная/неверным-секретом/
отсутствующая/неправильно-сформированная подпись — все 5 случаев дают верный результат (unit-тест
напрямую на функции, HMAC-SHA256 эквивалентен openssl). `handleWebhook` — вызван напрямую через
`NestFactory.createApplicationContext` (канал с вручную выставленным `igBusinessAccountId`,
поскольку реальный `initialize()` не прошёл без настоящего Meta-аккаунта) с синтетическим
конвертом из 2 записей: входящее сообщение создало ровно один `Client`(`igUserId`)+`TrackingEvent
(Lead)`, `is_echo` сообщение корректно пропущено, запись с неизвестным `entry.id` — тихо
пропущена с warning, без падения. GET-верификация вебхука — реальный HTTP-запрос с верным/неверным
`hub.verify_token` → корректный эхо-ответ `hub.challenge` / `403` соответственно. UI (выбор типа
канала Instagram, поля Facebook Page ID/Page Access Token) — проверен в реальном браузере, без
ошибок консоли. **Не проверено живьём**: нет реального Meta App/Facebook Page/Instagram Business
аккаунта в этой песочнице — полная подписка Page на вебхуки, реальная доставка/получение
сообщения, проверка подписи против настоящего `META_APP_SECRET` от Meta не выполнялись.

## Channels Service (оркестратор)

```typescript
// modules/channels/channels.service.ts

@Injectable()
export class ChannelsService {
  private providers = new Map<string, ChannelProvider>();
  
  constructor(
    private telegramProvider: TelegramProvider,
    private whatsAppProvider: WhatsAppProvider,
    private instagramProvider: InstagramProvider,
  ) {}
  
  // Получить провайдер для канала
  getProvider(channelType: ChannelType): ChannelProvider {
    const map = {
      TELEGRAM: this.telegramProvider,
      WHATSAPP: this.whatsAppProvider,
      INSTAGRAM: this.instagramProvider,
    };
    const provider = map[channelType];
    if (!provider) throw new Error(`Provider for ${channelType} not found`);
    return provider;
  }
  
  // Отправить сообщение через нужный провайдер
  async sendMessage(client: Client, options: SendMessageOptions): Promise<boolean> {
    const channelUserId = this.getChannelUserId(client);
    if (!channelUserId) return false;
    
    const provider = this.getProvider(client.channelType);
    return provider.sendMessage(channelUserId, options);
  }
  
  private getChannelUserId(client: Client): string | null {
    switch (client.channelType) {
      case 'TELEGRAM': return client.tgUserId;
      case 'WHATSAPP': return client.waPhone;
      case 'INSTAGRAM': return client.igUserId;
      default: return null;
    }
  }
  
  async createChannel(projectId: string, dto: CreateChannelDto): Promise<Channel> {
    const channel = await this.prisma.channel.create({
      data: { projectId, ...dto }
    });
    
    // Инициализировать провайдер
    const provider = this.getProvider(dto.type);
    await provider.initialize(channel);
    
    return channel;
  }
}
```

## Webhooks Controller

```typescript
// modules/webhooks/webhooks.controller.ts

@Controller('webhooks')
export class WebhooksController {
  
  // Telegram вебхук (один на каждый канал)
  @Public()
  @Post('telegram/:channelId')
  async telegramWebhook(
    @Param('channelId') channelId: string,
    @Body() update: any,
  ) {
    await this.telegramProvider.handleWebhook(channelId, update);
    return { ok: true };
  }
  
  // WhatsApp вебхук (верификация)
  @Public()
  @Get('whatsapp/:channelId')
  async whatsappVerify(
    @Param('channelId') channelId: string,
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    // Проверить verify_token из настроек канала
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return challenge;
    }
    throw new ForbiddenException();
  }
  
  @Public()
  @Post('whatsapp/:channelId')
  async whatsappWebhook(@Param('channelId') channelId: string, @Body() data: any) {
    await this.whatsAppProvider.handleWebhook(channelId, data);
    return { ok: true };
  }
}
```

## Channels Controller endpoints

```
POST   /api/v1/channels              — создать канал в проекте
GET    /api/v1/channels/:id          — получить канал
PATCH  /api/v1/channels/:id          — обновить настройки
DELETE /api/v1/channels/:id          — удалить канал
POST   /api/v1/channels/:id/test     — тест отправки сообщения
GET    /api/v1/channels/:id/health   — статус бота/канала
```

## Health Check для ботов

```typescript
// Задача в очереди — каждые 15 минут
@Cron('*/15 * * * *')
async checkChannelHealth() {
  const channels = await this.prisma.channel.findMany({
    where: { isActive: true }
  });
  
  for (const channel of channels) {
    try {
      if (channel.type === 'TELEGRAM') {
        const bot = this.telegramProvider.getBot(channel.id);
        await bot.api.getMe(); // проверка что токен валиден
        
        // Проверить что бот есть admin в канале
        if (channel.tgChannelId) {
          const member = await bot.api.getChatMember(
            channel.tgChannelId,
            (await bot.api.getMe()).id
          );
          if (!['administrator', 'creator'].includes(member.status)) {
            await this.notifyOwner(channel, 'Бот удалён из канала!');
          }
        }
      }
    } catch (error) {
      await this.notifyOwner(channel, `Ошибка канала: ${error.message}`);
    }
  }
}
```
