# 15 — Фазы разработки: Реальный план задач

## Как использовать этот файл
Этот файл — пошаговый чеклист для Claude Code.
Давай его вместе с нужным файлом архитектуры.
Например: "Реализуй задачи из Фазы 1, используй файлы 01-03"

---

## ФАЗА 1 — MVP (6-8 недель)
**Цель:** Рабочая система, первые клиенты, аналог Kosher-Track + CRM

### 1.1 Инфраструктура (День 1-3) — ✅ ГОТОВО (2026-06-21)
- [x] Инициализировать монорепо (npm workspaces)
- [x] Создать структуру папок по файлу 01_ARCHITECTURE.md
- [x] Настроить docker-compose.yml для dev (postgres, redis, minio)
- [x] Настроить tsconfig.json для всех пакетов
- [x] Создать packages/types/src/index.ts с enum'ами
- [x] Настроить ESLint + Prettier
- [x] Создать .env.example с описанием всех переменных

### 1.2 База данных (День 3-5) — ✅ ГОТОВО (2026-06-21)
- [x] Создать prisma/schema.prisma по файлу 02_DATABASE.md
- [x] Запустить первую миграцию: npx prisma migrate dev --name init
- [x] Создать prisma/seed.ts с тестовыми данными
- [x] Добавить дополнительные индексы (см. конец файла 02)
- [x] Проверить что все связи работают через Prisma Studio

### 1.3 Backend Core (День 5-10) — ✅ ГОТОВО (2026-06-22)
- [x] Создать apps/api с NestJS (npx @nestjs/cli new)
- [x] Настроить main.ts (helmet, cors, global prefix, swagger)
- [x] Создать PrismaService с AsyncLocalStorage middleware
- [x] Реализовать Auth модуль:
  - [x] RegisterDto, LoginDto
  - [x] AuthService (register, login, refresh, logout)
  - [x] JwtStrategy, RefreshStrategy
  - [x] AuthController (все 5 эндпоинтов)
  - [x] RefreshToken ротация
- [x] Создать CompanyContextMiddleware — реализовано как глобальный `CompanyContextInterceptor`,
      не Express middleware: в NestJS middleware идёт до guards, а req.user заполняется только
      JwtAuthGuard — буквальная middleware-реализация из дока никогда бы не сработала
- [x] Создать JwtAuthGuard (глобальный)
- [x] Создать RolesGuard (глобальный)
- [x] Создать SubscriptionGuard
- [x] Создать декораторы: @Roles, @Public, @CurrentUser, @Company
- [x] Создать HttpExceptionFilter с единым форматом ошибок

### 1.4 Projects Module (День 10-13) — ✅ ГОТОВО (2026-06-22)
- [x] ProjectsService (create, findAll, findOne, update, archive, regenerateTokens)
- [x] ProjectsController со всеми эндпоинтами
- [x] Логика findAll с разделением по ролям (OWNER видит все, ADVERTISER только свои)
- [x] Endpoint /snippet для получения кода интеграции
- [x] Endpoint /overview для статистики дашборда

### 1.5 Telegram Channel (День 13-18) — ✅ ГОТОВО (2026-06-22)
- [x] ChannelProvider interface
- [x] TelegramProvider:
  - [x] initialize() — регистрация webhook (+ обязательный bot.init() — без него grammy
        бросает "Bot not initialized" на каждый апдейт, дока об этом не упоминала)
  - [x] handleJoinRequest() — одобрение заявок
  - [x] handleStart() — обработка /start с параметром (Redis start-param bridge)
  - [x] sendMessage() — отправка с обработкой ошибок (403 → markBotBlocked)
  - [x] handleMemberUpdate() — отслеживание выхода (my_chat_member, бот удалён из канала)
  - [x] handleWebhook() — точка входа для обновлений
  - [x] **Доработано 2026-06-28** (реальный баг-репорт пользователя — см. 05_BACKEND_CHANNELS.md):
        проверка админства бота сразу при подключении; новый `handleChatMemberUpdate()` (chat_member,
        не my_chat_member) — сохраняет подписчиков публичных каналов без заявки на вступление,
        отмечает unsubscribe при выходе; `Channel.lastError` + `POST /channels/:id/reactivate` —
        реальная причина деактивации видна в UI, переподключение без пересоздания канала; лендинг/
        пуши теперь однозначно используют самый недавно подключённый активный Telegram-канал
        проекта (`orderBy: createdAt desc`, раньше порядок был не гарантирован)
  - [x] **Доработано 2026-06-29** (запрос пользователя на гибкую настройку флоу — см.
        05_BACKEND_CHANNELS.md, раздел "4 режима Telegram-лендинга"): `Channel.tgMode`
        (BOT_DIRECT/PRIVATE_CHANNEL_REQUEST/PUBLIC_CHANNEL_DIRECT/PERSONAL_DM) определяет,
        куда ведёт кнопка лендинга и какой механизм подписки работает — invite-ссылка с
        creates_join_request для приватных каналов, прямая ссылка на канал/личный аккаунт
        для прямых режимов (без бота вообще для PERSONAL_DM). `LandingRendererService`,
        шаблоны, SDK (`apps/sdk/src/browser.ts`) и форма канала на /settings обновлены
  - [x] **Доработано 2026-06-29, тот же день** (см. 05_BACKEND_CHANNELS.md, раздел
        "Редактирование канала + метаданные из Telegram в карточке"): редактирование уже
        созданного канала (`EditChannelDialog`, бэкенд-эндпоинт `PATCH /channels/:id` уже
        существовал, в UI кнопки не было); `fetchAndSaveMetadata()` в конце `initialize()`
        подтягивает название/число участников/фото канала или бота (`getChat`/
        `getChatMemberCount`) — новые поля `tgBotId`/`tgBotFirstName`/`tgChannelTitle`/
        `tgChannelMembersCount`/`tgAvatarFileId`; `GET /channels/:id/avatar` стримит фото
        сам (не отдаёт прямую ссылку Telegram — там в пути секретный токен бота); раскрытие
        токена (Eye/Copy) — только в диалоге редактирования, не в общем списке каналов
- [x] ChannelsService (оркестратор + регидратация активных ботов при старте процесса)
- [x] WebhooksController (Telegram endpoint)
- [x] Health check каждые 15 минут (cron, @nestjs/schedule)
- [x] Минимальный ClientsModule подтянут из 1.6 (findOrCreate/updateTracking/markBotBlocked) —
      без него TelegramProvider не на чём работать; полный CRM-функционал — см. 1.6 ниже

### 1.6 Clients CRM (День 18-22) — ✅ ГОТОВО (2026-06-22)
- [x] ClientsService.findOrCreate() — с geo IP определением (ip-api.com, глобальный fetch)
- [x] ClientsService.updateTracking() — привязка fbclid
- [x] ClientsService.markBotBlocked()
- [x] ClientsService.markUnsubscribed()
- [x] ClientsService.findMany() со всеми фильтрами
- [x] ClientsService.countPushAudience()
- [x] ClientsService.getClientsForPushInChunks() — курсорный async generator
- [x] ClientsRepository (сложные аналитические запросы)
- [x] ClientsController (все эндпоинты, вложен под /projects/:projectId/clients)
- [x] PurchasesService (create с idempotency + обработка гонки по unique constraint)
- [x] Регистрация покупок через Telegram команду /purchase — реализована полностью,
      плюс добавлена проверка прав (только админы канала), которой не было в доке
- [ ] PurchasesService.handleWebhook (внешний платёжный вебхук) — вне чеклиста 1.6,
      сознательно не реализован в этом шаге (08_BACKEND_CLIENTS.md его описывает,
      но 15_PHASES.md для 1.6 не требует)

### 1.7 Tracking (День 22-26) — ✅ ГОТОВО (2026-06-22)
- [x] TrackingController (публичный /track/:token/event + /track/server/:projectId/event с HMAC)
- [x] TrackingService (recordEvent с дедупликацией + P2002 race handling)
- [x] BullMQ очередь tracking-events (@nestjs/bull, не bullmq — см. примечание ниже)
- [x] TrackingProcessor (воркер)
- [x] FacebookCAPIService (sendEvent с SHA-256 хешированием, через fetch)
- [x] TikTokEventsService
- [x] Endpoint /tg-start для Telegram deep links — пишет в тот же Redis start:* ключ,
      который читает TelegramProvider.handleStart() (шаг 1.5); проверено end-to-end
      реальным HTTP-вызовом /tg-start → Redis → синтетический /start в боте
- [x] TelegramProvider.handleJoinRequest и PurchasesService.create переведены на
      TrackingService.recordEvent (раньше писали в TrackingEvent напрямую, в обход очереди)
- [x] **2026-06-27, архитектурное изменение по запросу пользователя**: проект больше не
      привязан к одной платформе. `Project.fbPixelId/fbAccessToken/ttPixelId/ttAccessToken`
      и `TrackingEvent.fbStatus/ttStatus/...` удалены; вместо них — `TrackingPixel`
      (many-to-one к Project, любое количество пикселей любых платформ одновременно)
      и `TrackingEventDelivery` (статус доставки на каждую пару событие+пиксель).
      Новый модуль `PixelsModule` (`/pixels`), `TrackingProcessor` рассылает событие во
      все активные пиксели проекта через `Record<PixelPlatform, PixelProvider>` (как
      `ChannelsService.providers` для каналов). `LandingRendererService` инжектит N
      `fbq('init',...)`/`ttq.load(...)` вызовов вместо одного. Фронтенд: `/projects/new`
      больше не собирает пиксели, `PixelsTab` в настройках — CRUD-список вместо двух
      фиксированных полей. Проверено живьём: 2 FB-пикселя + 1 TikTok на одном проекте,
      рассылка одного события дала 3 независимые записи `TrackingEventDelivery`,
      лендинг корректно отрендерил оба `fbq('init')`.

### 1.8 Pushes (День 26-31) — ✅ ГОТОВО (2026-06-22)
- [x] PushesService (create, recalculateAudience, send) — + findAll/findOne/update/cancel/findLogs
- [x] BullMQ очередь push-messages с rate limiting (30/сек, см. ограничение в 09_BACKEND_PUSHES.md
      про общий лимитер на всю очередь, а не per-bot — сознательная заплата MVP)
- [x] PushProcessor (воркер с обработкой 403 ошибок) — 403 уже обрабатывается внутри
      TelegramProvider.sendMessage (шаг 1.5), процессор лишь фиксирует итог в PushLog
- [x] PushesController (все эндпоинты, вложен под /projects/:projectId/pushes)
- [x] Cron: сброс лимитов пушей каждый месяц (скользящие 30 дней от pushesResetAt)
- [x] Cron: проверка истёкших подписок каждый час (логирование + деактивация каналов;
      реальное ограничение доступа уже делает SubscriptionGuard в реальном времени)
- [x] 09_BACKEND_PUSHES.md написан с нуля (был пустым stub) — см. feedback-памятку
      о том, что для шагов с пустым doc сначала пишем сам doc

### 1.9 Landings — базовые шаблоны (День 31-36) — ✅ ГОТОВО (2026-06-26)
- [x] Создать 3 HTML шаблона (minimal, gradient, dark)
- [x] LandingsService (createFromTemplate, getTemplates) — + findAll/findOne/update/publish/unpublish/remove
- [x] LandingRendererService (renderTemplate, injectTrackingScripts) — + renderPreviewHtml для дашборда;
      добавлена поддержка {{#if}}...{{else}}...{{/if}} (доки не было, а minimal-шаблон её требует)
- [x] InternalController для Nginx (только localhost)
- [x] NginxService (addServerBlock, шаблон конфига) — заготовка под шаг 2.2 (Domains/Cloudflare),
      ничего пока не вызывает его сам, но рендер/запись/удаление конфига проверены живьём
- [x] LandingsController (основные эндпоинты) — без CUSTOM/EXTERNAL (ZIP-загрузка, MinIO,
      внешний лендинг) — это отдельные шаги 2.3/2.4 по 15_PHASES.md, не входят в "базовые шаблоны"
- [x] TelegramProvider.initialize() дополнен: сохраняет channel.tgBotUsername из bot.botInfo —
      без этого deep-link на лендинге (https://t.me/{{BOT_USERNAME}}?start=...) был бы всегда пустым

### 1.10 Crypto Billing — TRC-20 (День 36-40) — ✅ ГОТОВО (2026-06-26)
- [x] Константы PLANS (цены не были зафиксированы ни в одном доке — выбраны разумные дефолты,
      см. 10_BACKEND_BILLING.md; легко поменять, это просто константы, не БД)
- [x] BillingService (createInvoice, checkPayment, activateSubscription) — + findAll/findOne/
      findOneInternal/getPlans/getCurrentUsage/expireStaleInvoices
- [x] CryptoPaymentService:
  - [x] generatePaymentAddress() через HD Wallet TRC-20 — детерминированная деривация индекса
        из invoiceId (sha256), без миграции схемы под отдельное поле индекса
  - [x] checkTronTransaction() через TronGrid API — допуск недоплаты до 1%, graceful null
        при сетевой ошибке/нерабочем TronGrid (не 500)
  - [x] stopMonitoring()
- [x] BullMQ очередь payment-monitoring (repeatable job каждые 15с до expiresAt)
- [x] BillingController (все эндпоинты) — + крон раз в 5 мин на подчистку зависших PENDING-счетов
- [x] Установлены tronweb/bip39/bip32/tiny-secp256k1; TRON_HD_MNEMONIC/USDT_TRC20_CONTRACT в .env

### 1.11 Frontend MVP (День 40-55) — ✅ ГОТОВО (2026-06-27)
- [x] Инициализировать Next.js 14 с shadcn/ui — реально получили Tailwind v4 + Base UI
      (не Radix) под капотом текущей версии shadcn CLI, см. "почему" ниже
- [x] Настроить api.ts (axios + interceptors для refresh) — общий refreshPromise на все
      параллельные 401, чтобы не гонять refresh-токен (он одноразовый, rotation)
- [x] Настроить auth.store.ts (Zustand) — persist в localStorage + флаг hydrated
      (без него AuthGuard на /(dashboard) ложно редиректил бы на /login при каждой перезагрузке)
- [x] Настроить React Query (providers.tsx)
- [x] Страницы: /login, /register, / (overview), /projects, /projects/new, /projects/[id],
      /projects/[id]/settings (Основные/Каналы/Пиксели/Интеграция/Опасная зона — без таба
      "Команда": бэкенда для управления сотрудниками нет ни в одном модуле), /projects/[id]/clients,
      /projects/[id]/pushes, /projects/[id]/pushes/new (3-шаговый мастер), /billing, /settings
      (только Профиль read-only + История платежей — по той же причине, нет users/company API)
- [x] Компоненты: Sidebar (без "Домены"/"Команда" — Domains это Фаза 2, Team-бэкенда нет),
      Header, StatsCard, ClientsTable + ClientsFilter, ClientDetailDrawer, PushContentStep,
      PushAudienceStep (live-счётчик через PATCH черновика пуша — отдельного preview-эндпоинта
      аудитории без сохранения нет, использован уже существующий recalculate-путь),
      PaymentModal (QR через `qrcode`, таймер до expiresAt, поллинг статуса инвойса)

### 1.12 Deploy (День 55-60)
- [x] Создать Dockerfile для api — multi-stage, собран и прогнан локально с реальными
      Postgres/Redis (миграции, сидинг, /health) — см. "почему" ниже
- [x] Создать Dockerfile для web — multi-stage, `output: 'standalone'`; собран и
      прогнан локально
- [x] Настроить docker-compose.prod.yml — без отдельного `worker` (см. ниже), без
      MinIO (нигде не используется реальным кодом)
- [x] Написать infra/nginx/nginx.conf + conf.d/main.conf — проверено end-to-end
      (nginx + реальные api/web контейнеры в одной docker-сети, временные
      self-signed сертификаты, HTTPS до обоих доменов и HTTP→HTTPS редирект)
- [x] Написать infra/scripts/deploy.sh
- [x] Написать infra/scripts/setup-ssl.sh — переписан относительно черновика из
      14_INFRA_AND_DEPLOY.md: сначала временный self-signed сертификат (чтобы nginx
      смог подняться и отдать ACME challenge), потом настоящий через webroot
- [x] Написать infra/scripts/backup.sh
- [x] Настроить GitHub Actions CI/CD — .github/workflows/deploy.yml
- [x] Задокументировать переменные окружения — .env.prod.example
- [ ] Первый деплой на Hetzner — **не выполнено**: нет реального сервера/домена/SSH-доступа
      в этой среде. Подготовлен infra/scripts/server-setup.sh для одноразового бутстрапа —
      выполняется пользователем вручную, когда сервер и домен будут готовы.

### 1.13 Биллинг на балансе (вместо инвойса на тариф) — ✅ ГОТОВО (2026-06-27)
- [x] `Company.balance` (Decimal), `Invoice` больше не хранит `plan`/`planDurationDays` —
      это просто пополнение баланса, см. 10_BACKEND_BILLING.md
- [x] Новая модель `BalanceTransaction` (append-only леджер: TOPUP/SUBSCRIPTION_CHARGE/DOWNGRADE)
- [x] `BillingService.createTopUp`/`creditBalance` — пополнение баланса вместо прямой активации тарифа
- [x] `BillingService.selectPlan`/`chargeForPlan` — атомарное списание цены тарифа с баланса
      (`updateMany` с условием `balance >= price` в `WHERE`, защита от гонки между ручным выбором
      и кроном продления); применяется сразу, если хватает баланса, иначе 400 без изменений
- [x] `BillingService.runRenewals`/`downgradeToTrial` — крон каждые 15 минут продлевает покупные
      тарифы списанием с баланса или сбрасывает компанию на TRIAL (`planExpiresAt: null`, бессрочно)
      при недостатке средств
- [x] Фронтенд /billing переделан: карточка баланса + пополнение (пресеты/своя сумма), карточки
      тарифов теперь "Выбрать"/"Продлить сейчас" (мгновенное списание), таблицы "Пополнения" и
      "История операций"
- [x] PaymentModal адаптирован под пополнение баланса вместо оплаты конкретного тарифа
- [x] Живая проверка: top-up → credit → select-plan (списание+лимиты) → runRenewals успешный
      (продление) → runRenewals неуспешный (даунгрейд до TRIAL) → проверено в браузере (Playwright)

### 1.14 Мультисетевая оплата (TRC-20/ERC-20/BEP-20) + автосвип на счёт владельца — ✅ ГОТОВО (2026-06-27)
- [x] `PaymentNetworkProvider` интерфейс (`generateAddress`/`checkTransaction`/`sweepToOwner`) — тот же
      паттерн, что `ChannelProvider`/`PixelProvider`; `CryptoPaymentService` диспетчеризует по
      `Record<PaymentNetwork, PaymentNetworkProvider>`, не знает деталей конкретной сети
- [x] `TronUsdtProvider` — рефакторинг существующей TRC-20 логики под интерфейс, без изменения поведения
- [x] `EvmUsdtProvider` (ethers.js, новая зависимость) — один параметризуемый класс на Ethereum (ERC-20)
      и BSC (BEP-20), не два дублирующих класса; учтена разница decimals (USDT ERC-20 — 6 знаков,
      Binance-Peg USDT BEP-20 — 18 знаков, частая ошибка)
- [x] `Invoice.network` теперь выбирается клиентом при пополнении (`CreateTopUpDto.network`), а не
      хардкодится; `GET /billing/networks` — список поддерживаемых сетей для фронтенда
- [x] Автосвип оплаты на счёт владельца (`CryptoPaymentService.sweepToOwner`) — два шага на каждой сети:
      отдельный газовый кошелёк (`*_GAS_PRIVATE_KEY`, не из HD-мнемоники инвойсов) присылает газ
      (TRX/ETH/BNB) на адрес инвойса → весь USDT уходит на `OWNER_PAYOUT_ADDRESS_TRC20`/`_EVM`.
      Best-effort, не блокирует зачисление баланса; результат — `Invoice.sweptAt/sweepTxHash/sweepError`
- [x] `BillingCron.retrySweeps` (каждые 15 мин) повторяет неудавшиеся свипы
- [x] `.env`/`.env.example`/`.env.prod.example` — все non-secret переменные (RPC-урлы, контракты USDT
      по сетям, суммы газа) заполнены реальными дефолтами; приватные ключи газовых кошельков и
      `ETH_HD_MNEMONIC` оставлены пустыми плейсхолдерами — пользователь генерирует их сам
      (вне auto-mode: создание новых приватных ключей для реальных денег требует явного решения
      пользователя, не делается агентом самостоятельно)
- [x] Живая проверка TRC-20-пути: top-up → симуляция найденного платежа → `creditBalance` зачисляет
      баланс и корректно фиксирует `sweepError` при невалидном (ещё не настоянном) газовом ключе,
      не блокируя зачисление. Браузер: селектор сети на /billing рендерится без ошибок (Playwright).
      ERC-20/BEP-20 пути не проверены живьём — нет настоящих `ETH_HD_MNEMONIC`/RPC-доступа в этой среде.

### 1.15 Подготовка к интеграции Heleket (хостед-гейтвей) — ✅ ГОТОВО (2026-06-27)
- [x] API сверен по официальной документации doc.heleket.com (создание инвойса, формат вебхука,
      формула подписи `md5(base64(json) + apiKey)`, экранирование `/` как у PHP `json_encode`)
- [x] `PaymentGatewayProvider` интерфейс (createInvoice/verifyWebhookSignature/parseWebhook) — отдельный
      от `PaymentNetworkProvider`, т.к. модель принципиально другая (хостед, без своих ключей/свипа)
- [x] `HeleketGatewayProvider` + `HeleketService` (резолвит конфиг через ConfigService, как
      `CryptoPaymentService` для остальных сетей)
- [x] `Invoice.provider`/`Invoice.gatewayUuid` (миграция) — `SELF_HOSTED`/`HELEKET`, разводит
      creditBalance/attemptSweep (HELEKET не мониторится BullMQ и не свипается — Heleket сам зачисляет
      на свой меречант-баланс)
- [x] `POST /billing/topup/heleket` + `POST /billing/webhooks/heleket` (`@Public()`, проверка подписи
      обязательна до доверия payload — иначе подделка вебхука = бесплатное пополнение баланса)
- [x] `.env`/`.env.example`/`.env.prod.example`: `HELEKET_API_URL`/`HELEKET_MERCHANT_ID`/`HELEKET_API_KEY`
      (два последних — пустые плейсхолдеры, реальных ключей нет)
- [x] Фронтенд: задизейбленная кнопка "Heleket (скоро)" на /billing — без активной интеграции,
      не вводит пользователей в заблуждение нерабочей кнопкой без пометки
- [x] Живая проверка без реальных ключей: `/billing/topup/heleket` возвращает понятную 500-ошибку
      ("HELEKET_MERCHANT_ID/HELEKET_API_KEY не настроены"), не создаёт зависший PENDING-инвойс
      (сразу EXPIRED при сбое), формула подписи проверена детерминированным тестом без сети.
      **Реальная интеграция не активна** — нужны настоящие `HELEKET_MERCHANT_ID`/`HELEKET_API_KEY` от
      пользователя и хотя бы один тест с реальным вебхуком перед включением в проде.

---

## ФАЗА 2 — Расширение (4-6 недель)
**Цель:** Конкурентные преимущества над Kosher-Track

### 2.1 WhatsApp Business API — ✅ ГОТОВО (2026-06-27)
- [x] WhatsAppProvider (initialize, sendMessage, handleWebhook) — через 360dialog (BSP), endpoint
      `waba-v2.360dialog.io`, заголовок `D360-API-KEY`, см. 05_BACKEND_CHANNELS.md
- [x] Webhook верификация для WhatsApp — Basic Auth (генерируется нами при initialize, у
      360dialog нет HMAC-подписи в отличие от Meta при прямом подключении)
- [x] Обновить ChannelsService — WHATSAPP в карте providers, регидратация при старте процесса,
      checkChannelHealth обобщён по типу канала
- [x] UI: добавить WhatsApp в выбор канала — селектор типа канала в ChannelsTab
      (apps/web/.../projects/[id]/settings/page.tsx), условные поля под каждый тип
- [x] Обновить Push систему для WhatsApp — не требовалось правок: PushesService/ChannelsService.sendMessage
      уже были канало-агностичны (диспетчеризация по client.channelType), достаточно зарегистрировать
      провайдер в карте
- Миграция: `Channel.waWebhookUsername`/`waWebhookPassword` (20260627180000_whatsapp_webhook_basic_auth)
- Живой тест (см. 05_BACKEND_CHANNELS.md за деталями, без реального WhatsApp-номера): создание
  канала с фейковым токеном → реальный 401 от 360dialog, isActive:false; синтетический webhook без/с
  неверным Basic Auth → игнорируется; с верным Basic Auth → создаётся Client + TrackingEvent(Lead);
  sendMessage с фейковым токеном → `{sent:false}` без падения процесса
- Не проверено живьём: реальная отправка/приём с настоящим 360dialog-аккаунтом и номером

### 2.2 Домены (self-service) — ✅ ГОТОВО (2026-06-28)
- [x] ~~CloudflareService~~ — отклонено архитектурным решением от 2026-06-27 (см.
      04_BACKEND_PROJECTS_DOMAINS.md): платформа не держит Cloudflare API-токен и не управляет
      DNS клиента, клиент сам настраивает свой домен. `Domain.cfZoneId`/`cfRecordId` убраны из схемы.
- [x] DomainsService полная реализация (create/findAll/findOne/verify/attachLanding/remove)
- [x] Автоматическое создание Nginx конфигов — через общий `NginxService` (тот же, что у лендингов,
      шаг 1.9), не отдельный сервис
- [x] Certbot SSL для клиентских доменов — HTTP-01 webroot challenge через контейнер `certbot`
      (`docker compose run --rm certbot certonly`), запускается из `verify()` сразу после TXT-проверки
- [x] UI: страница доменов со статусами и инструкциями (`/domains`, таблица + TXT/A-инструкция)
- Миграция: `Domain.cfZoneId`/`cfRecordId` удалены, добавлен `lastCheckError` (20260628000000_domain_drop_cloudflare_fields)
- env: `CERTBOT_EMAIL`, `SERVER_PUBLIC_IP` (заменили `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ZONE_ID`)
- Попутно исправлен баг: `PrismaService`'s tenant-scoping middleware включал `Domain` в
  `modelsWithCompany`, авто-инъецируя `deletedAt: null` для модели без такой колонки — убран
  из списка по образцу `Channel`
- Живой тест: создание домена → реальные инструкции; verify без TXT → реальный `dns.resolveTxt`,
  корректный `lastCheckError`, статус остаётся PENDING (retryable)
- Не проверено живьём: путь после успешного TXT (реальный вызов Certbot/Let's Encrypt) —
  auto-mode заблокировал реальный сетевой запрос к внешнему CA без явного разрешения,
  пользователь предпочёл пропустить тест, а не разрешать его для заведомо бессмысленной проверки
- [x] **Доработано 2026-06-29** — механизм Nginx/Certbot полностью переписан на системный nginx
      (контейнерный certbot из пункта выше не мог занять порты 80/443, см.
      04_BACKEND_PROJECTS_DOMAINS.md), выпуск сертификата живьём подтверждён на реальных доменах.
- [x] **Доработано 2026-06-29, позже тот же день** (запрос пользователя: "один домен на
      несколько проектов и несколько лэндов используя /path/path", см.
      04_BACKEND_PROJECTS_DOMAINS.md, раздел "Один домен → много лендингов/проектов через
      путь"): `attachLanding`/`Domain.landingId` (1 домен = 1 лендинг) заменены моделью
      `DomainPath` (N путей на домен, любой путь → лендинг любого проекта компании). Nginx
      target-файл стал домен-агностичным (всегда `serve-by-domain`, путь резолвится бэкендом
      по БД) — добавление/смена/удаление путей больше не требует nginx reload вообще. Голый
      домен без явного маппинга пути (включая корень `/`) теперь отдаёт 404. UI `/domains`
      переписан: клик по домену открывает диалог с путями (реальные кликабельные полные
      ссылки) и каскадным выбором Проект→Лендинг вместо одного длинного списка всех лендингов.

### 2.3 Кастомный лендинг (ZIP загрузка) — ✅ ГОТОВО (2026-06-28)
- [x] StorageService (MinIO — uploadDirectory, getObjectStream/Buffer, removePrefix); бакет
      приватный, отдаётся только через InternalController (тот же trust boundary, что у TEMPLATE)
- [x] LandingsService.uploadCustomLanding() — ре-загрузка ZIP в существующий лендинг, плюс
      createCustom() — создание нового CUSTOM-лендинга сразу из ZIP (доп. эндпоинт, не было
      в исходном плане, но нужен — иначе UI требовал бы создать пустой лендинг перед загрузкой)
- [x] Multer конфиг для загрузки файлов — `FileInterceptor('file', {limits:{fileSize:50MB}})`,
      memoryStorage по умолчанию (storage/dest не заданы)
- [x] LandingRendererService.serveCustomFile() — плюс пробросили под-путь через NginxService
      ($request_uri) и InternalController (wildcard-маршрут) — CUSTOM-лендинг это не одна
      страница, а index.html + css/js/картинки, каждый файл нужно уметь отдать отдельно
- [x] UI: drag-and-drop загрузка ZIP — `apps/web/.../projects/[id]/landings/page.tsx` (страница
      управления лендингами проекта целиком построена с нуля, её не было вообще)
- Защита: zip-slip (явная проверка путей `..`/абсолютных вдобавок к встроенной в adm-zip),
  валидация index.html в корне, 50MB лимит, ре-загрузка подчищает старые файлы перед заливкой новых
- Живой тест backend (curl): загрузка реального ZIP (index.html+css+картинка) → файлы реально
  в MinIO; publish → serve вернул HTML с инжектом трекинга, ассеты — 200 с верным Content-Type;
  ре-загрузка удалила старые файлы; ZIP без index.html/не-ZIP — отклонены; zip-slip ZIP — отклонён
  до распаковки (вредоносный файл не попал на диск)
- Живой тест UI (Playwright, headless-браузер): полный сценарий регистрация→проект→загрузка
  ZIP через реальный file input→публикация→предпросмотр (blob URL с реальным HTML) — без единой
  ошибки в консоли браузера
- Не проверено: нативный drag-and-drop (только путь "клик → выбор файла")

### 2.4 Внешний лендинг (SDK / API) — ✅ ГОТОВО (2026-06-28)
- [x] apps/sdk — npm пакет (`@trafficcrm/sdk`, в workspace `apps/*`)
- [x] browser.ts (JS snippet с auto-track) — PageView авто, `[data-track]`-клики, перехват
      `[href*="t.me"]`/`[data-tg-bot]` ссылок с генерацией start-кода и открытием deep link
- [x] index.ts (серверный SDK с HMAC подписью) — `TrackClient` с `event`/`pageView`/`lead`/
      `subscribe`/`initiateCheckout`/`purchase`; типы (`EventData`/`EventName`) приведены в точное
      соответствие с реальным `TrackEventDto` (whitelist), не с черновиком из 13_SDK_AND_SNIPPET.md
- [x] Сборка через esbuild в track.js — `apps/sdk/esbuild.config.js` (iife/cjs/esm) + `tsc
      --emitDeclarationOnly` для `.d.ts`
- [x] Хостинг track.js на CDN (MinIO) — отдельный публичный бакет `trafficcrm-cdn` (public-read
      policy), НЕ тот же бакет, что приватные кастомные лендинги из 2.3; `apps/sdk/scripts/
      publish-cdn.js` создаёт бакет+policy+аплоад; прод — `cdn.yourdomain.com` vhost в Nginx
- [x] UI: вкладка "Интеграция" в настройках проекта — уже существовала с 1.11 (токены/CORS-домены/
      JS-сниппет), доработана: добавлены табы Node.js SDK / PHP / Python с копированием, сниппет
      теперь включает обязательный `data-api-url`
- [x] PHP пример в документации — `getSnippet()` возвращает `phpExample` (и `pythonExample` сверху
      по списку, не было в чеклисте, но добавлено заодно — оба реально исполнены живым тестом)
- Живой тест: серверный SDK (HMAC) и PHP/Python REST-примеры из `getSnippet()` — каждый создал
  настоящий `TrackingEvent`, запущены как настоящий код (`node`/`php`/venv `python`), не только
  тайпчек; неверный `secretKey` корректно отклонён. Браузерный track.js — реально скачан с
  публичного CDN-бакета (не из исходников) и подключён на статической HTML-странице на другом
  origin, чем API (имитация внешнего лендинга клиента): авто-PageView, клик по `[data-track]`,
  клик по `t.me`-ссылке → `tg-start` → Redis `start:<code>` с тем же набором полей, что читает
  `TelegramProvider.handleStart()` — полная цепочка атрибуции с внешнего лендинга до Telegram
  подтверждена end-to-end. UI вкладки "Интеграция" проверен в реальном браузере, без ошибок консоли.

### 2.5 ERC-20 оплата — ✅ ГОТОВО (реализовано раньше срока, в Фазе 1)
- [x] generatePaymentAddress() для Ethereum через ethers.js — `EvmUsdtProvider.generateAddress`
      (`apps/api/src/modules/billing/providers/evm-usdt.provider.ts`), один параметризованный класс
      для ETH и BSC сразу (не два почти одинаковых)
- [x] checkEthTransaction() через Infura API — на деле через Etherscan/BscScan "tokentx" API, не
      Infura (см. `crypto-payment.service.ts` — Infura упомянут в этом доке, но в реальном коде для
      проверки транзакций используется блок-эксплорер API, Infura не подключался)
- [x] UI: выбор сети (TRC-20 / ERC-20) при оплате — `/billing` Select, плюс BEP-20 сверху по списку
- Сделано не по этому шагу отдельно, а в рамках более широкого "multi-network payments + auto-sweep"
  изменения в конце Фазы 1 (см. [[project-trafficcrm-implementation-progress]] — запись от
  2026-06-27) — пользователь явно решил пропустить этот пункт сейчас при проходе по списку, и
  оказалось, что пропускать нечего, работа уже сделана раньше.

### 2.6 Instagram Direct — ✅ ГОТОВО (2026-06-28)
- [x] InstagramProvider (sendMessage, handleWebhook) — реальный Meta Graph API (Messenger
      Platform, Page-connected flow), контракт сверен по developers.facebook.com, не по
      псевдокоду 05_BACKEND_CHANNELS.md (тот ходил на неверный путь `${igPageId}/messages`)
- [x] Meta Webhook верификация — `GET /webhooks/instagram` (hub.challenge эхо) +
      `POST /webhooks/instagram` (X-Hub-Signature-256, общий META_APP_SECRET) — **архитектурно
      отличается** от Telegram/WhatsApp: один вебхук на всё приложение, не per-channel; роутинг на
      Channel — по `igBusinessAccountId` (получаем сами в initialize(), это НЕ `igPageId`)
- [x] UI: добавить Instagram в выбор канала — `ChannelsTab`, поля Facebook Page ID + Page Access Token
- Живой тест: фейковый `igAccessToken` → реальный `400 Invalid OAuth access token` от Graph API,
  канал корректно помечен `isActive:false` (как у Telegram/WhatsApp); `sendMessage`/test — то же;
  `verifySignature` — 5 случаев (валидная/подделанная/неверный секрет/без заголовка/без префикса)
  через unit-тест; `handleWebhook` — вызван напрямую (`NestFactory.createApplicationContext`) с
  синтетическим конвертом — создал ровно один Client+Lead-событие, `is_echo` пропущено, неизвестный
  `entry.id` пропущен без падения; GET-верификация — реальный 200+challenge / 403 для верного/
  неверного `verify_token`. UI проверен в браузере, без ошибок консоли.
- Не проверено живьём: нет реального Meta App/Facebook Page/Instagram аккаунта в песочнице —
  полная подписка Page на вебхуки и реальная доставка/получение сообщения не выполнялись.

### 2.7 Analytics расширенная
- [ ] Воронка конверсий
- [ ] Разбивка по странам и каналам
- [ ] График выручки по дням
- [ ] UI: страница /projects/[id]/analytics

### 2.8 Lookalike Export
- [ ] ClientsRepository.getClientsForLookalikeExport()
- [ ] CSV генерация в формате Facebook
- [ ] UI: кнопка "Lookalike Export" на странице клиентов

---

## ФАЗА 3 — Growth (4-6 недель)
**Цель:** Уникальные фичи которых нет у конкурентов

### 3.1 Автоворонки (Drip Campaigns)
```
Схема: Trigger → Delay → Action → Condition → Action
Пример: Подписался → Подождать 1 день → Отправить пуш A →
        Если не купил → Подождать 2 дня → Отправить пуш B
```
- [ ] Модель AutomationFlow в БД
- [ ] AutomationEngine (обработка событий, запуск воронок)
- [ ] Визуальный конструктор воронок (drag-and-drop)

### 3.2 A/B тестирование лендингов
- [ ] Поле abTestEnabled + abTestRatio в Landing
- [ ] Логика сплита трафика 50/50
- [ ] Статистика по вариантам (конверсия A vs B)
- [ ] UI: создание A/B теста

### 3.3 Viber интеграция
- [ ] ViberProvider
- [ ] Viber Bot API webhook

### 3.4 Smart Push Timing
- [ ] Анализ когда пуши дают лучший CTR (по часам)
- [ ] Рекомендации оптимального времени отправки
- [ ] UI: "Оптимальное время: 18:00-20:00 МСК"

### 3.5 Webhook от платёжных систем
- [ ] PurchasesService.handleWebhook()
- [ ] Документация для: Stripe, PayPal, LiqPay, CloudPayments
- [ ] UI: настройка webhook URL в проекте

### 3.6 Team Analytics
- [ ] Статистика по рекламщикам (кто сколько клиентов привёл)
- [ ] Сравнение проектов внутри компании

### 3.7 Мультиканальные пуши
- [ ] Один пуш — отправляется через все каналы клиента
- [ ] Приоритет: если есть Telegram — через Telegram, иначе WhatsApp

---

## ФАЗА 4 — Enterprise (по мере роста)

### 4.1 Telegram MTProto (личный аккаунт)
- [ ] Интеграция telethon/MTProto
- [ ] Шифрование сессий
- [ ] Чтение диалогов (статистика)
- [ ] Правовые соглашения

### 4.2 White-label
- [ ] Кастомный домен дашборда на компанию
- [ ] Кастомный логотип и цвета
- [ ] Скрыть "TrafficCRM" брендинг

### 4.3 Super Admin панель
- [ ] Список всех компаний
- [ ] Статистика использования
- [ ] Ручная активация подписки
- [ ] Мониторинг ошибок

### 4.4 Kubernetes
- [ ] Helm charts
- [ ] HPA (auto-scaling воркеров под нагрузкой)
- [ ] Разделение воркеров по типам очередей

---

## Порядок подачи файлов в Claude Code

### Для начала (Фаза 1, шаг 1.1-1.4):
```
Прочти эти файлы по порядку и реализуй шаги 1.1-1.4:
- 00_MASTER_OVERVIEW.md
- 01_ARCHITECTURE.md
- 02_DATABASE.md
- 03_BACKEND_CORE.md
- 15_PHASES.md (только Фаза 1, шаги 1.1-1.4)
```

### Для каналов (шаг 1.5):
```
Реализуй шаг 1.5 (Telegram Channel):
- 05_BACKEND_CHANNELS.md
- 15_PHASES.md (шаг 1.5)
```

### Для трекинга (шаг 1.7):
```
Реализуй шаг 1.7 (Facebook CAPI + TikTok):
- 06_BACKEND_TRACKING.md
- 15_PHASES.md (шаг 1.7)
```

### Для лендингов (шаг 1.9):
```
Реализуй шаг 1.9 (Landing шаблоны):
- 07_BACKEND_LANDINGS.md
- 15_PHASES.md (шаг 1.9)
```

### Для фронтенда (шаг 1.11):
```
Реализуй шаг 1.11 (Frontend):
- 11_FRONTEND_DASHBOARD.md
- 12_FRONTEND_PAGES.md
- 15_PHASES.md (шаг 1.11)
```

---

## Контрольные точки готовности

### MVP готов когда:
- [ ] Можно зарегистрировать компанию
- [ ] Создать проект с Telegram ботом
- [ ] Бот принимает заявки и регистрирует клиентов
- [ ] События идут в Facebook CAPI (проверить через Events Manager)
- [ ] Можно создать лендинг и привязать домен
- [ ] Работает рассылка с базовыми фильтрами
- [ ] Оплата через USDT TRC-20 работает и активирует подписку
- [ ] Все страницы фронтенда работают

### Фаза 2 готова когда:
- [ ] WhatsApp бот принимает сообщения
- [ ] Клиентские домены добавляются автоматически через Cloudflare
- [ ] ZIP лендинг загружается и отображается
- [ ] JS Snippet работает и отправляет события
- [ ] npm SDK можно установить и использовать

---

## Рекомендации по работе с Claude Code

1. **Работай модулями** — давай один файл инструкций за раз + файл 15 с конкретными шагами

2. **Проверяй после каждого модуля** — запускай сервер и тестируй эндпоинты через Swagger

3. **Сохраняй контекст** — начинай каждый сеанс с:
   "Мы строим TrafficCRM. Уже реализовано: [список]. Сейчас нужно: [задача]"

4. **Тестируй пиксели через Events Manager** — FB предоставляет Test Events tool в Ads Manager → Events Manager → Test Events

5. **Для Telegram** — используй @BotFather для создания тестового бота, ngrok для локального webhook в dev режиме

6. **Для Cloudflare API** — создай API Token с разрешениями: Zone:Read, DNS:Edit, Zone Settings:Edit
