# 01 — Архитектура и структура проекта

## Задача для Claude Code
Создай монорепо с нуля используя npm workspaces.

## Команды для инициализации

```bash
mkdir trafficcrm && cd trafficcrm
git init
npm init -y

# Создать структуру папок
mkdir -p apps/api apps/web apps/sdk
mkdir -p packages/types packages/utils
mkdir -p infra/docker infra/nginx infra/scripts
mkdir -p prisma
```

## Root package.json

```json
{
  "name": "trafficcrm",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "concurrently \"npm run dev:api\" \"npm run dev:web\"",
    "dev:api": "npm run dev --workspace=apps/api",
    "dev:web": "npm run dev --workspace=apps/web",
    "build": "npm run build --workspaces",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:studio": "prisma studio"
  },
  "devDependencies": {
    "concurrently": "^8.2.0",
    "typescript": "^5.3.0"
  }
}
```

## apps/api — NestJS Backend

### Инициализация
```bash
cd apps/api
npx @nestjs/cli new . --package-manager npm --skip-git
```

### Установка зависимостей
```bash
npm install @nestjs/config @nestjs/jwt @nestjs/passport @nestjs/bull
npm install @prisma/client prisma
npm install passport passport-jwt passport-local
npm install bcryptjs class-validator class-transformer
npm install @nestjs/swagger swagger-ui-express
npm install bullmq ioredis
npm install grammy  # Telegram
npm install axios zod
npm install ethers  # ERC-20
npm install tronweb # TRC-20
npm install @aws-sdk/client-s3  # MinIO совместим с S3 API
npm install sharp  # обработка изображений
npm install helmet compression
npm install --save-dev @types/bcryptjs @types/passport-jwt
```

### Структура apps/api/src/

```
src/
├── main.ts
├── app.module.ts
│
├── common/                          — общие утилиты
│   ├── decorators/
│   │   ├── company.decorator.ts     — @Company() из JWT
│   │   ├── user.decorator.ts        — @User() из JWT
│   │   └── public.decorator.ts      — @Public() bypass auth
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   ├── roles.guard.ts
│   │   └── subscription.guard.ts    — проверка лимитов подписки
│   ├── interceptors/
│   │   └── company-filter.interceptor.ts  — авто-фильтр по company_id
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── pipes/
│   │   └── zod-validation.pipe.ts
│   └── utils/
│       ├── hash.util.ts             — SHA-256 для FB
│       ├── crypto.util.ts           — HMAC подписи
│       └── pagination.util.ts
│
├── config/                          — конфиги через @nestjs/config
│   ├── app.config.ts
│   ├── database.config.ts
│   ├── redis.config.ts
│   └── cloudflare.config.ts
│
├── prisma/                          — Prisma сервис
│   └── prisma.service.ts
│
├── modules/
│   ├── auth/                        — регистрация, логин, токены
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── strategies/
│   │   │   ├── jwt.strategy.ts
│   │   │   └── refresh.strategy.ts
│   │   └── dto/
│   │       ├── login.dto.ts
│   │       └── register.dto.ts
│   │
│   ├── companies/                   — мультитенантность
│   │   ├── companies.module.ts
│   │   ├── companies.controller.ts
│   │   └── companies.service.ts
│   │
│   ├── users/                       — пользователи, роли
│   │   ├── users.module.ts
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   └── dto/
│   │
│   ├── projects/                    — проекты
│   │   ├── projects.module.ts
│   │   ├── projects.controller.ts
│   │   ├── projects.service.ts
│   │   └── dto/
│   │
│   ├── domains/                     — домены + Cloudflare
│   │   ├── domains.module.ts
│   │   ├── domains.controller.ts
│   │   ├── domains.service.ts
│   │   └── cloudflare.service.ts
│   │
│   ├── channels/                    — абстракция каналов
│   │   ├── channels.module.ts
│   │   ├── channels.controller.ts
│   │   ├── channels.service.ts
│   │   ├── providers/               — реализации каналов
│   │   │   ├── channel.provider.interface.ts
│   │   │   ├── telegram.provider.ts
│   │   │   ├── whatsapp.provider.ts
│   │   │   ├── instagram.provider.ts
│   │   │   └── viber.provider.ts
│   │   └── dto/
│   │
│   ├── landings/                    — лендинг билдер
│   │   ├── landings.module.ts
│   │   ├── landings.controller.ts
│   │   ├── landings.service.ts
│   │   ├── renderer.service.ts      — рендер HTML с пикселями
│   │   └── dto/
│   │
│   ├── tracking/                    — пиксели и события
│   │   ├── tracking.module.ts
│   │   ├── tracking.controller.ts   — публичный эндпоинт для SDK
│   │   ├── tracking.service.ts
│   │   ├── facebook-capi.service.ts
│   │   ├── tiktok-events.service.ts
│   │   └── dto/
│   │
│   ├── clients/                     — CRM клиентов
│   │   ├── clients.module.ts
│   │   ├── clients.controller.ts
│   │   ├── clients.service.ts
│   │   └── dto/
│   │
│   ├── pushes/                      — рассылки
│   │   ├── pushes.module.ts
│   │   ├── pushes.controller.ts
│   │   ├── pushes.service.ts
│   │   ├── push.processor.ts        — BullMQ воркер
│   │   └── dto/
│   │
│   ├── purchases/                   — покупки
│   │   ├── purchases.module.ts
│   │   ├── purchases.controller.ts
│   │   └── purchases.service.ts
│   │
│   ├── analytics/                   — статистика и графики
│   │   ├── analytics.module.ts
│   │   ├── analytics.controller.ts
│   │   └── analytics.service.ts
│   │
│   ├── billing/                     — подписки и оплата
│   │   ├── billing.module.ts
│   │   ├── billing.controller.ts
│   │   ├── billing.service.ts
│   │   ├── crypto-payment.service.ts
│   │   └── dto/
│   │
│   ├── webhooks/                    — входящие вебхуки от Telegram и т.д.
│   │   ├── webhooks.module.ts
│   │   └── webhooks.controller.ts
│   │
│   └── storage/                     — MinIO файлы
│       ├── storage.module.ts
│       └── storage.service.ts
```

## apps/web — Next.js Frontend

### Инициализация
```bash
cd apps/web
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
npx shadcn-ui@latest init
```

### Установка зависимостей
```bash
npm install @tanstack/react-query axios zustand
npm install react-hook-form @hookform/resolvers zod
npm install recharts
npm install lucide-react
npm install next-themes  # dark/light mode
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu
```

### Структура apps/web/src/

```
src/
├── app/
│   ├── (auth)/                      — страницы без авторизации
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── layout.tsx
│   │
│   ├── (dashboard)/                 — страницы с авторизацией
│   │   ├── layout.tsx               — sidebar + header
│   │   ├── page.tsx                 — главная / overview
│   │   ├── projects/
│   │   │   ├── page.tsx             — список проектов
│   │   │   ├── new/page.tsx         — создать проект
│   │   │   └── [id]/
│   │   │       ├── page.tsx         — overview проекта
│   │   │       ├── settings/page.tsx
│   │   │       ├── clients/page.tsx
│   │   │       ├── pushes/page.tsx
│   │   │       └── analytics/page.tsx
│   │   ├── domains/page.tsx
│   │   ├── landings/page.tsx
│   │   ├── billing/page.tsx
│   │   └── settings/page.tsx
│   │
│   └── api/                         — Next.js API routes (минимум)
│       └── auth/[...nextauth]/
│
├── components/
│   ├── ui/                          — shadcn компоненты
│   ├── layout/
│   │   ├── sidebar.tsx
│   │   ├── header.tsx
│   │   └── page-header.tsx
│   ├── projects/
│   ├── clients/
│   ├── pushes/
│   ├── analytics/
│   └── billing/
│
├── lib/
│   ├── api.ts                       — axios instance
│   ├── auth.ts                      — токены, refresh
│   └── utils.ts
│
├── hooks/
│   ├── use-auth.ts
│   ├── use-company.ts
│   └── use-projects.ts
│
└── store/
    ├── auth.store.ts                — Zustand
    └── ui.store.ts
```

## packages/types — Shared типы

```typescript
// packages/types/src/index.ts

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  ADVERTISER = 'ADVERTISER',
}

export enum ChannelType {
  TELEGRAM = 'TELEGRAM',
  WHATSAPP = 'WHATSAPP',
  INSTAGRAM = 'INSTAGRAM',
  VIBER = 'VIBER',
  EMAIL = 'EMAIL',
}

export enum TrackingEvent {
  PAGE_VIEW = 'PageView',
  LEAD = 'Lead',
  SUBSCRIBE = 'Subscribe',
  PURCHASE = 'Purchase',
  INITIATE_CHECKOUT = 'InitiateCheckout',
}

export enum PushStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  SENDING = 'SENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

export enum SubscriptionPlan {
  TRIAL = 'TRIAL',
  STARTER = 'STARTER',
  GROWTH = 'GROWTH',
  SCALE = 'SCALE',
  ENTERPRISE = 'ENTERPRISE',
}
```

## apps/sdk — npm пакет

```
sdk/
├── src/
│   ├── index.ts          — TrackClient класс
│   ├── browser.ts        — browser bundle (для snippet)
│   └── types.ts
├── package.json
└── tsconfig.json
```

## Важные паттерны кода

### Company Filter Interceptor (ОБЯЗАТЕЛЬНО ВЕЗДЕ)
Каждый запрос к БД должен содержать `company_id`. Создай interceptor который автоматически добавляет это условие в Prisma запросы через `AsyncLocalStorage`.

### Response формат (единый для всего API)
```typescript
// Success
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "total": 100 }  // для списков
}

// Error
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "...",
    "details": [...]
  }
}
```

### Версионирование API
Все роуты под `/api/v1/` prefix. В main.ts:
```typescript
app.setGlobalPrefix('api/v1');
```
