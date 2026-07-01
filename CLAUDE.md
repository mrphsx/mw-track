# TrafficCRM

Multi-tenant SaaS CRM for media buyers (traffic arbitrage). Spec docs (00-15) are complete; real implementation is underway following [15_PHASES.md](15_PHASES.md) phase by phase. As of 2026-06-22, Phase 1 steps 1.1-1.5 are done (infra, DB, backend core/auth, Projects module, Telegram channel) — see 15_PHASES.md checkboxes for current status.

## Before doing anything

Read [00_MASTER_OVERVIEW.md](00_MASTER_OVERVIEW.md) first, then the numbered doc matching the area you're touching (01-15, listed in 00's file map). Each numbered doc beyond 00 is currently a TODO stub with section headers only — fill them in as that part of the system gets built, don't let them go stale.

## Hard invariants (do not violate when writing code here)

- Every DB query that touches tenant data must be scoped by `company_id`. This is enforced at the middleware level, not by convention — if you add a new table or query path, it must go through that scoping.
- Channels (Telegram, WhatsApp, Instagram, Viber, Email) implement one `ChannelProvider` interface. Adding a channel = new class implementing that interface, never an if/else branch in business logic.
- Tracking events (PageView, Lead, Purchase) are written to an `events` table first, then pushed to Facebook/TikTok asynchronously via queue. Never call Facebook CAPI / TikTok Events API synchronously from the request path.
- All pushes go through BullMQ queues with rate limiting (30 msg/sec for Telegram). Never send a push directly.
- Every external/idempotent-sensitive request carries an `idempotency_key`.
- No hard deletes — every delete is `deleted_at` soft delete. Exceptions (documented deviations, not oversights): `Channel` has no `deletedAt` column; its "delete" is `isActive: false` (bot/webhook torn down, row kept). `Domain` also has no `deletedAt` column; its "delete" is a genuine hard delete (`domain` hostname is globally `@unique` — soft-deleting would permanently block re-adding the same hostname later). Both are excluded from the `PrismaService` tenant-scoping middleware's `modelsWithCompany` list for the same reason — that middleware auto-injects `deletedAt: null` into every read, which would throw `Unknown argument` against either model.

## Stack quick reference

Backend: NestJS 10 + Prisma 5 + PostgreSQL 16 + Redis/BullMQ. Frontend: Next.js 14 App Router + TailwindCSS/shadcn + Zustand + React Query. Telegram via Grammy.js (webhook only, no polling). WhatsApp via 360dialog. Crypto payments: USDT TRC-20 (TronGrid) / ERC-20 (Infura/Alchemy) via HD wallet, one address per payment. Full list with versions in [00_MASTER_OVERVIEW.md](00_MASTER_OVERVIEW.md).

## Doc maintenance

When a numbered doc (01-15) goes from stub to real content, also update [15_PHASES.md](15_PHASES.md) to reflect what phase actually shipped — it's the source of truth for "what's done vs planned," don't let it drift from reality.
