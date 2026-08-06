# 02 — База данных (Prisma Schema)

## Задача для Claude Code
Создай файл `prisma/schema.prisma` со следующей схемой.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// МУЛЬТИТЕНАНТНОСТЬ
// ============================================================

model Company {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique  // для сабдомена: slug.yourdomain.com
  logoUrl     String?

  // Баланс — пополняется крипто-инвойсами (Invoice), списывается автоматически
  // кроном раз в 15 минут за активную подписку (см. 10_BACKEND_BILLING.md)
  balance Decimal @db.Decimal(10, 2) @default(0)

  // Подписка
  plan              SubscriptionPlan @default(TRIAL)
  planExpiresAt     DateTime? // когда наступит следующее автосписание; null = не продлевается автоматически (TRIAL/ENTERPRISE)
  maxProjects       Int @default(1)
  maxClients        Int @default(1000)
  maxPushesPerDay   Int @default(2)
  
  // Лимиты использования
  currentProjects   Int @default(0)
  currentClients    Int @default(0)
  pushesToday       Int @default(0)
  pushesResetAt     DateTime @default(now())
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  
  users               User[]
  projects            Project[]
  domains             Domain[]
  landings            Landing[]
  invoices            Invoice[]
  balanceTransactions BalanceTransaction[]
}

// ============================================================
// ПОЛЬЗОВАТЕЛИ И РОЛИ
// ============================================================

model User {
  id           String   @id @default(cuid())
  companyId    String
  email        String   @unique
  passwordHash String
  firstName    String
  lastName     String?
  role         UserRole @default(ADVERTISER)
  avatarUrl    String?
  isActive     Boolean  @default(true)
  lastLoginAt  DateTime?
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  
  company          Company @relation(fields: [companyId], references: [id])
  projectAccess    ProjectAccess[]
  refreshTokens    RefreshToken[]
  
  @@index([companyId])
}

model RefreshToken {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// Доступ рекламщика к конкретным проектам
model ProjectAccess {
  id        String @id @default(cuid())
  userId    String
  projectId String
  
  createdAt DateTime @default(now())
  
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@unique([userId, projectId])
}

// ============================================================
// ПРОЕКТЫ
// ============================================================

model Project {
  id          String  @id @default(cuid())
  companyId   String
  name        String
  description String?
  status      ProjectStatus @default(ACTIVE)
  
  // Токены для внешних интеграций
  publicToken  String @unique @default(cuid())  // для JS Snippet
  secretKey    String @unique                    // для серверного API
  
  // Разрешённые домены для CORS (внешние интеграции)
  allowedDomains String[] @default([])
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  
  company       Company         @relation(fields: [companyId], references: [id])
  channels      Channel[]
  pixels        TrackingPixel[] // проект не привязан к платформе — пикселей любых платформ может быть несколько одновременно
  domains       Domain[]
  landings      Landing[]
  clients       Client[]
  pushes        Push[]
  events        TrackingEvent[]
  purchases     Purchase[]
  projectAccess ProjectAccess[]
  
  @@index([companyId])
  @@index([publicToken])
}

// ============================================================
// КАНАЛЫ ОБЩЕНИЯ
// ============================================================

model Channel {
  id        String      @id @default(cuid())
  projectId String
  type      ChannelType
  name      String
  isActive  Boolean     @default(true)
  lastError String?     // причина последней деактивации (initialize()/health-check) — для UI, добавлено 2026-06-28
  
  // Telegram специфично
  tgBotToken     String?
  tgChannelId    String?  // числовой ID канала
  tgChannelUsername String? // @username
  tgBotUsername  String?
  tgWelcomeMessage String?
  
  // WhatsApp специфично
  waPhoneNumberId String?
  waAccessToken   String?
  wa360Token      String? // 360dialog токен (D360-API-KEY)
  waWebhookUsername String? // Basic Auth для входящих вебхуков от 360dialog
  waWebhookPassword String? // генерируются нами при initialize(), не вводятся пользователем
  
  // Instagram специфично — igPageId/igAccessToken вводит пользователь (Facebook Page ID +
  // Page Access Token), igBusinessAccountId заполняем сами в initialize() (см. 05_BACKEND_CHANNELS.md,
  // Фаза 2.6) — это ID, который реально приходит в entry.id входящего вебхука, не igPageId.
  igPageId             String?
  igAccessToken        String?
  igBusinessAccountId  String?
  
  // Viber специфично
  viberBotToken   String?
  viberWebhookUrl String?
  
  // Email специфично
  emailFromName   String?
  emailFromAddr   String?
  sendgridApiKey  String?
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  project Project @relation(fields: [projectId], references: [id])
  
  @@index([projectId])
}

// ============================================================
// ДОМЕНЫ
// ============================================================

model Domain {
  id        String       @id @default(cuid())
  companyId String
  projectId String?
  domain    String       @unique
  status    DomainStatus @default(PENDING)
  
  sslStatus   String?     // active, pending, error
  
  // Верификация (TXT запись) — self-service, без Cloudflare со стороны платформы
  // (решение от 2026-06-27, см. 04_BACKEND_PROJECTS_DOMAINS.md): cfZoneId/cfRecordId убраны.
  verificationToken  String @unique @default(cuid())
  verifiedAt         DateTime?
  lastCheckError     String? // диагностика последней неудачной проверки TXT/выпуска SSL
  
  // Привязка к лендингу
  landingId String?
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  company Company  @relation(fields: [companyId], references: [id])
  project Project? @relation(fields: [projectId], references: [id])
  landing Landing? @relation(fields: [landingId], references: [id])
  
  @@index([companyId])
}

// ============================================================
// ЛЕНДИНГИ
// ============================================================

model Landing {
  id        String      @id @default(cuid())
  companyId String
  projectId String
  name      String
  type      LandingType @default(TEMPLATE)
  status    LandingStatus @default(DRAFT)
  
  // Для шаблонных лендингов
  templateId   String?  // ключ шаблона
  templateData Json?    // настройки: цвета, тексты, картинки
  
  // Для кастомных лендингов (ZIP загрузка)
  customFileUrl  String?  // путь в MinIO
  customBasePath String?  // путь где распакован
  
  // Для внешних лендингов (серверы клиента)
  isExternal Boolean @default(false)  // использует SDK
  
  // SEO
  metaTitle       String?
  metaDescription String?
  faviconUrl      String?
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  
  company Company  @relation(fields: [companyId], references: [id])
  project Project  @relation(fields: [projectId], references: [id])
  domains Domain[]
  
  @@index([companyId, projectId])
}

// ============================================================
// КЛИЕНТЫ (CRM)
// ============================================================

model Client {
  id          String  @id @default(cuid())
  companyId   String
  projectId   String
  
  // Telegram данные
  tgUserId   String?
  tgUsername String?
  tgFirstName String?
  tgLastName  String?
  tgLanguage  String?
  tgPhotoUrl  String?
  
  // WhatsApp данные
  waPhone    String?
  waName     String?
  
  // Instagram данные
  igUserId   String?
  igUsername String?
  
  // Контактные данные (если собрали через форму)
  email      String?
  phone      String?
  
  // Трекинг
  fbclid     String?
  ttclid     String?
  utmSource   String?
  utmMedium   String?
  utmCampaign String?
  utmContent  String?
  utmTerm     String?
  
  // Технические данные
  ipAddress   String?
  userAgent   String?
  country     String?
  city        String?
  
  // Статусы
  channelType   ChannelType?
  isSubscribed  Boolean @default(true)   // в канале
  isBotActive   Boolean @default(true)   // не заблокировал бота
  hasPurchase   Boolean @default(false)
  
  // Финансы
  totalSpent     Decimal @default(0) @db.Decimal(10,2)
  purchasesCount Int     @default(0)
  
  // Временные метки
  firstSeenAt    DateTime  @default(now())
  subscribedAt   DateTime?
  lastActiveAt   DateTime?
  unsubscribedAt DateTime?
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  
  project   Project    @relation(fields: [projectId], references: [id])
  purchases Purchase[]
  pushLogs  PushLog[]
  events    TrackingEvent[]
  
  @@index([companyId, projectId])
  @@index([tgUserId, projectId])
  @@index([fbclid])
}

// ============================================================
// ТРЕКИНГ СОБЫТИЙ
// ============================================================

model TrackingEvent {
  id          String           @id @default(cuid())
  projectId   String
  clientId    String?
  
  eventName   String           // PageView, Lead, Purchase, etc.
  eventTime   DateTime         @default(now())
  eventId     String           @unique  // для дедупликации FB
  
  // Данные события
  payload     Json             // полный payload
  
  // Источник события
  source      EventSource @default(SERVER)  // browser, server, sdk
  
  createdAt DateTime @default(now())
  
  project    Project                 @relation(fields: [projectId], references: [id])
  client     Client?                 @relation(fields: [clientId], references: [id])
  deliveries TrackingEventDelivery[] // статус отправки в каждый привязанный к проекту пиксель отдельно
  
  @@index([projectId, eventName])
  @@index([projectId, createdAt])
}

// ============================================================
// ПИКСЕЛИ (FACEBOOK CAPI / TIKTOK EVENTS / ...)
// ============================================================

// Проект сам по себе не привязан к платформе — пикселей может быть несколько
// (несколько FB-аккаунтов, FB+TikTok разом и т.д.), каждый со своими credentials.
model TrackingPixel {
  id        String        @id @default(cuid())
  projectId String
  platform  PixelPlatform
  label     String?       // для различения нескольких пикселей одной платформы в UI
  
  pixelId       String  // Facebook Pixel ID / TikTok Pixel Code
  accessToken   String  // CAPI / Events API access token
  testEventCode String? // только Facebook, для отладки CAPI
  
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  project    Project                 @relation(fields: [projectId], references: [id], onDelete: Cascade)
  deliveries TrackingEventDelivery[]
  
  @@index([projectId])
}

enum PixelPlatform {
  FACEBOOK
  TIKTOK
}

// Один ряд на пару (событие, пиксель) — раньше статус хранился прямо в TrackingEvent
// двумя колонками (fbStatus/ttStatus), что подразумевало ровно один FB- и один
// TikTok-пиксель на проект. Теперь пикселей много, статус — для каждой пары отдельно.
model TrackingEventDelivery {
  id              String   @id @default(cuid())
  eventId         String
  pixelId         String
  status          String   // sent, error
  externalEventId String?  // ID, который вернула платформа
  error           String?
  sentAt          DateTime @default(now())
  
  event TrackingEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  pixel TrackingPixel @relation(fields: [pixelId], references: [id], onDelete: Cascade)
  
  @@unique([eventId, pixelId])
  @@index([eventId])
}

// ============================================================
// ПОКУПКИ
// ============================================================

model Purchase {
  id        String @id @default(cuid())
  projectId String
  clientId  String
  
  amount    Decimal @db.Decimal(10,2)
  currency  String  @default("USD")
  
  // Внешний ID заказа (от системы клиента)
  externalOrderId String?
  idempotencyKey  String? @unique
  
  // Регистрация
  registeredBy String?  // userId кто добавил вручную, null если API/бот
  source       String   @default("manual")  // manual, api, bot, webhook
  
  // Трекинг отправлен?
  fbSent Boolean @default(false)
  ttSent Boolean @default(false)
  
  createdAt DateTime @default(now())
  
  project Project @relation(fields: [projectId], references: [id])
  client  Client  @relation(fields: [clientId], references: [id])
  
  @@index([projectId])
  @@index([clientId])
}

// ============================================================
// ПУШИ (РАССЫЛКИ)
// ============================================================

model Push {
  id        String     @id @default(cuid())
  projectId String
  name      String
  status    PushStatus @default(DRAFT)
  
  // Контент
  messageText  String
  messageMedia Json?    // { type: 'photo'|'video', url: '...' }
  buttons      Json?    // [{ text: '...', url: '...' }]
  
  // Фильтр аудитории
  filter Json  // PushFilter объект
  
  // Предварительный расчёт аудитории
  audienceTotal    Int @default(0)   // всего в базе по фильтру
  audienceReachable Int @default(0)  // из них доступны для пуша
  
  // Планирование
  scheduledAt DateTime?
  
  // Результаты
  sentAt       DateTime?
  sentCount    Int @default(0)
  deliveredCount Int @default(0)
  failedCount  Int @default(0)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  project Project   @relation(fields: [projectId], references: [id])
  logs    PushLog[]
  
  @@index([projectId])
}

// Лог отправки пуша каждому клиенту
model PushLog {
  id       String     @id @default(cuid())
  pushId   String
  clientId String
  status   String     // pending, sent, delivered, failed
  error    String?
  sentAt   DateTime?
  
  push   Push   @relation(fields: [pushId], references: [id])
  client Client @relation(fields: [clientId], references: [id])
  
  @@index([pushId])
  @@index([pushId, status])
}

// ============================================================
// БИЛЛИНГ
// ============================================================

// Инвойс — это пополнение баланса, а не покупка конкретного тарифа: тариф выбирается/
// продлевается отдельно списанием с уже пополненного баланса (см. BalanceTransaction
// и BillingService.selectPlan/runRenewals в 10_BACKEND_BILLING.md)
model Invoice {
  id        String        @id @default(cuid())
  companyId String
  
  amount    Decimal @db.Decimal(10,2) // сколько пополняем
  currency  String  @default("USDT")
  
  status    InvoiceStatus @default(PENDING)

  // SELF_HOSTED (свои HD-адреса) или HELEKET (хостед-гейтвей, готовится к интеграции,
  // см. 10_BACKEND_BILLING.md) — определяет, как обрабатываются creditBalance/sweep
  provider String @default("SELF_HOSTED")

  // Крипто оплата — сеть выбирает клиент: TRC20 (TRON), ERC20 (Ethereum), BEP20 (BSC),
  // либо код сети Heleket при provider=HELEKET
  network        String?   // TRC20, ERC20, BEP20, ...
  paymentAddress String?   // адрес для оплаты
  txHash         String?   // хэш транзакции
  paidAmount     Decimal?  @db.Decimal(10,2)
  paidAt         DateTime?
  expiresAt      DateTime  // 30 минут на оплату

  // Только для provider=HELEKET — их uuid инвойса (для запроса статуса/resend-webhook)
  gatewayUuid String?

  // Свип на счёт владельца (best-effort, не блокирует зачисление баланса, только SELF_HOSTED) — см. 10_BACKEND_BILLING.md
  sweptAt     DateTime?
  sweepTxHash String?
  sweepError  String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  company             Company              @relation(fields: [companyId], references: [id])
  balanceTransactions BalanceTransaction[]
  
  @@index([companyId])
  @@index([paymentAddress])
}

// Леджер баланса: пополнения (TOPUP, привязаны к Invoice) и автосписания за подписку
// (SUBSCRIPTION_CHARGE — успешное продление/выбор тарифа, DOWNGRADE — не хватило
// средств, тариф сброшен до TRIAL). Append-only, записи не редактируются и не удаляются.
model BalanceTransaction {
  id           String                 @id @default(cuid())
  companyId    String
  type         BalanceTransactionType
  amount       Decimal                @db.Decimal(10, 2) // + для TOPUP, - для SUBSCRIPTION_CHARGE, 0 для DOWNGRADE
  balanceAfter Decimal                @db.Decimal(10, 2)
  plan         SubscriptionPlan? // на какой тариф списание/даунгрейд — не задан для TOPUP
  invoiceId    String? // какой инвойс пополнил баланс — только для TOPUP
  createdAt    DateTime               @default(now())

  company Company  @relation(fields: [companyId], references: [id])
  invoice Invoice? @relation(fields: [invoiceId], references: [id])

  @@index([companyId, createdAt])
}

enum BalanceTransactionType {
  TOPUP
  SUBSCRIPTION_CHARGE
  DOWNGRADE
}

// ============================================================
// ENUMS
// ============================================================

enum UserRole {
  SUPER_ADMIN
  OWNER
  ADMIN
  ADVERTISER
}

enum ChannelType {
  TELEGRAM
  WHATSAPP
  INSTAGRAM
  VIBER
  EMAIL
}

enum ProjectStatus {
  ACTIVE
  PAUSED
  ARCHIVED
}

enum DomainStatus {
  PENDING       // добавлен, ждём верификации
  VERIFYING     // проверяем DNS
  ACTIVE        // работает
  ERROR         // ошибка DNS
}

enum LandingType {
  TEMPLATE  // встроенный шаблон
  CUSTOM    // загруженный ZIP
  EXTERNAL  // на сервере клиента
}

enum LandingStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

enum PushStatus {
  DRAFT
  SCHEDULED
  SENDING
  SENT
  FAILED
}

enum SubscriptionPlan {
  TRIAL
  STARTER
  GROWTH
  SCALE
  ENTERPRISE
}

enum InvoiceStatus {
  PENDING
  PAID
  EXPIRED
  CANCELLED
}

enum EventSource {
  BROWSER   // JS Pixel на лендинге
  SERVER    // наш сервер (Telegram бот)
  SDK       // внешний сервер клиента
}
```

## Seed данные

Создай `prisma/seed.ts`:

```typescript
// Создать super admin компанию и пользователя
// Создать тарифные планы (хранятся как константы, не в БД)
// Создать 3-5 шаблонов лендингов (хранятся в JSON файлах)

const PLAN_LIMITS = {
  TRIAL:      { maxProjects: 1,  maxClients: 1000,   maxPushesPerDay: 2   },
  STARTER:    { maxProjects: 5,  maxClients: 5000,   maxPushesPerDay: 10  },
  GROWTH:     { maxProjects: 10, maxClients: 25000,  maxPushesPerDay: 50  },
  SCALE:      { maxProjects: 20, maxClients: 100000, maxPushesPerDay: 240 },
  ENTERPRISE: { maxProjects: 50, maxClients: 999999, maxPushesPerDay: 999 },
};
```

## Migrations

```bash
npx prisma migrate dev --name init
npx prisma generate
npx prisma db seed
```

## Индексы для производительности

Дополнительно создай миграцию с составными индексами:

```sql
-- Для поиска клиентов по фильтрам пушей
CREATE INDEX idx_clients_push_filter ON "Client" 
  ("projectId", "isBotActive", "isSubscribed", "hasPurchase", "channelType");

-- Для аналитики по времени
CREATE INDEX idx_events_project_time ON "TrackingEvent" 
  ("projectId", "eventName", "eventTime" DESC);

-- Для поиска по fbclid (связка лендинг → Telegram)
CREATE INDEX idx_clients_fbclid ON "Client" ("fbclid") 
  WHERE "fbclid" IS NOT NULL;
```
