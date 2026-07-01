# TrafficCRM — мастер-документ для Claude Code

## Что строим
Мультитенантная SaaS CRM-платформа для медиабайеров.
Трафик: Facebook Ads, TikTok Ads
Каналы назначения: Telegram, WhatsApp, Instagram Direct, Viber, Email
Лендинги: встроенный билдер + внешние серверы через SDK/API
Оплата: Crypto (USDT TRC-20, ERC-20)

## Файлы инструкций (читать по порядку)

```
00_MASTER_OVERVIEW.md         — этот файл, общая картина
01_ARCHITECTURE.md            — структура проекта, папки, стек
02_DATABASE.md                — схема БД, все таблицы, связи
03_BACKEND_CORE.md            — Auth, мультитенантность, роли
04_BACKEND_PROJECTS.md        — Проекты, домены, Cloudflare
05_BACKEND_CHANNELS.md        — Telegram, WhatsApp, Instagram, Viber
06_BACKEND_TRACKING.md        — Facebook CAPI, TikTok Events API, SDK
07_BACKEND_LANDINGS.md        — Лендинг билдер, хостинг, кастомный домен
08_BACKEND_CLIENTS.md         — CRM клиентов, фильтры, сегменты
09_BACKEND_PUSHES.md          — Система пушей, очереди, статистика
10_BACKEND_BILLING.md         — Crypto оплата, подписки, лимиты
11_FRONTEND_DASHBOARD.md      — Next.js дашборд, роутинг, UI
12_FRONTEND_PAGES.md          — Все страницы и компоненты
13_SDK_AND_SNIPPET.md         — JS Snippet, REST API, npm SDK
14_INFRA_AND_DEPLOY.md        — Docker, Nginx, CI/CD, Hetzner
15_PHASES.md                  — Фазы разработки, MVP → Full
```

## Технический стек

### Backend
- Runtime: Node.js 20 LTS
- Framework: NestJS 10 + TypeScript
- ORM: Prisma 5
- Database: PostgreSQL 16
- Cache/Queue: Redis 7 + BullMQ
- Validation: Zod + class-validator
- Auth: JWT + Refresh Tokens
- File storage: MinIO (self-hosted S3)

### Frontend
- Framework: Next.js 14 (App Router)
- UI: TailwindCSS + shadcn/ui
- State: Zustand + React Query (TanStack)
- Forms: React Hook Form + Zod
- Charts: Recharts

### Telegram боты
- Library: Grammy.js
- Webhook режим (не polling)

### WhatsApp
- Provider: WhatsApp Cloud API (Meta) через 360dialog

### Инфраструктура
- Server: Hetzner CPX51 (старт)
- Reverse proxy: Nginx
- SSL: Cloudflare (через API)
- Containers: Docker + Docker Compose
- DNS управление: Cloudflare API

### Crypto оплата
- USDT TRC-20: TronGrid API
- USDT ERC-20: Infura / Alchemy
- Кошелёк на депозит: HD Wallet (один адрес на платёж)

## Принципы архитектуры

1. **Мультитенантность через company_id** — каждый запрос фильтруется по company_id на уровне middleware, физически невозможно получить чужие данные

2. **Абстрактный Channel Provider** — все каналы (Telegram, WhatsApp и т.д.) реализуют единый интерфейс ChannelProvider. Добавление нового канала = новый класс, без изменения бизнес-логики

3. **Event Sourcing для трекинга** — все события (PageView, Lead, Purchase) сначала сохраняются в events таблицу, потом асинхронно через очереди отправляются в Facebook/TikTok. Гарантия доставки.

4. **Queue-first для пушей** — пуши никогда не отправляются напрямую, только через BullMQ очереди с rate limiting (30 msg/sec для Telegram)

5. **Idempotency везде** — все внешние запросы имеют idempotency_key для защиты от дублей

6. **Soft delete** — данные никогда не удаляются физически, только помечаются deleted_at

## Структура монорепо

```
/
├── apps/
│   ├── api/          — NestJS backend
│   ├── web/          — Next.js frontend
│   └── sdk/          — npm пакет для клиентов
├── packages/
│   ├── types/        — shared TypeScript типы
│   ├── utils/        — shared утилиты
│   └── ui/           — shared UI компоненты (опционально)
├── infra/
│   ├── docker/
│   ├── nginx/
│   └── scripts/
├── prisma/
│   └── schema.prisma
├── docker-compose.yml
├── docker-compose.prod.yml
└── package.json      — workspaces root
```

## Переменные окружения (главные)

```env
# App
NODE_ENV=production
APP_URL=https://app.yourdomain.com
API_URL=https://api.yourdomain.com
CDN_URL=https://cdn.yourdomain.com

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/trafficcrm

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=...
JWT_REFRESH_SECRET=...

# Cloudflare
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ZONE_ID=...

# MinIO
MINIO_ENDPOINT=...
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...

# Crypto wallets
TRON_HD_MNEMONIC=...   # для генерации адресов TRC-20
ETH_HD_MNEMONIC=...    # для генерации адресов ERC-20
TRONGRID_API_KEY=...
INFURA_PROJECT_ID=...
```
