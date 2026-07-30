# TrafficCRM

Multi-tenant SaaS CRM for media buyers (traffic arbitrage), branded MWTRACK in the product UI. Spec docs (00-15) are complete; real implementation is underway following [15_PHASES.md](15_PHASES.md) phase by phase. As of 2026-07-02, Phase 1 is done including the first real production deploy (162.213.248.131, mw-track.com), Phase 2 steps 2.1-2.9 (2.7 Analytics/2.8 Lookalike Export confirmed done 2026-07-15, 2.9 = Team/roles Phase 1), 2.11 (audience overlap + Telegram client enrichment), and 2.12 (landing tracking links: pixel + Facebook/TikTok ad macros, customizable query-param names, ad/campaign breakdown) are done; Phase 3 steps 3.1 (Drip Campaigns/automation flows: trigger→delay→push→condition, linear step-list UI instead of drag-and-drop), 3.2 (A/B/n testing for landing pages: group N existing landings with per-landing traffic weights, card-click multi-select UI, no-cookie random split per request, comparison stats; extended 2026-07-17 so a domain/path binds to either one landing directly or the whole test group, not implicitly via landing membership), 3.4 (Smart Push Timing: CTR-by-hour analysis, first click-tracking in the project via a public push-button redirect endpoint) are done as of 2026-07-15, and 3.6 (Team Analytics: buyer attribution via a hidden query-param on the tracking link rather than landing ownership, "БЕЗ БАЕРА" bucket for unattributed clients, company-wide project comparison) done 2026-07-17 (3.3 paused, 3.5 cancelled, 3.7 obsolete per user scope decisions — Phase 3 otherwise complete); and Phase 4 step 4.1 (Telegram MTProto personal account, client dialogue tracking) shipped ahead of schedule on explicit user request; on 2026-07-22, bot scenarios were merged conceptually with 3.1's automation flows (shared step-chain idea — DELAY/SEND_MESSAGE/CONDITION, new `BotScenarioStep`/`BotScenarioRun` — but deliberately separate tables/engine, since scenario runs must be able to re-fire per client while automation enrollments are one-per-client-forever) and gained a step-chain editor + ≤10-item media gallery with video-note support at `/projects/[id]/scenarios`, while automation flows (3.1) were temporarily hidden from the UI (code/data untouched) per explicit user request; on 2026-07-25, the welcome message moved out of channel settings into scenarios entirely (new `SUBSCRIBE` trigger, replacing `Channel.tgWelcomeMessage*`/`sendWelcomeMessage`), the video-note pipeline was rewritten to always re-encode via ffmpeg's own runtime filter expressions instead of a skip-if-already-square fast path (the real cause of frequent kruzhok failures across formats/resolutions), and the scenario editor was redesigned around "elements" (one content type + optional button each, delay embedded per-element instead of a separate step type, condition/standalone-delay hidden from the UI for now); also on 2026-07-25, A/B testing shipped for bot scenarios (mirrors landing A/B groups — `ScenarioAbTestGroup`, weighted random variant pick per trigger firing with no client stickiness, 6 client-snapshot conversion metrics, synthetic `command` values to sidestep `BotScenario`'s unique constraint), including a same-day `endAbTest` lifecycle bug fix (member scenarios' `abTestGroupId` wasn't cleared, blocking a second test) plus a retroactive backfill for the one real production test already corrupted by it; and on 2026-07-27, per-event-type switches were added to gate whether tracking events get forwarded to Facebook/TikTok (`Project.disabledTrackingEvents`, gated in `TrackingService.recordEvent` alongside the existing ad-attribution check — the CRM's own `TrackingEvent` write is never affected), with a visible on/off indicator row on the project overview page and a new "События" settings tab; narrowed the same day to just the 3 event types the backend fires on its own initiative (Subscribe/Dialogue/Purchase — PageView/Lead/InitiateCheckout/Click are explicit SDK calls the tenant already controls in their own landing code, so a CRM switch for those is redundant), and made the switch gate only the automatic firing path via a new `RecordEventDto.forceSend` escape hatch — manual staff actions (the "Зарегистрировать диалог" button, the "Добавить покупку" form) keep forwarding to ad platforms even while the switch is off; and the same day, message personalization placeholders (`{first_name}`/`{last_name}`/`{full_name}`/`{username}`) shipped for both pushes and bot scenarios via one shared `renderMessagePlaceholders` helper, wired into `ChannelsService.sendMessage` (pushes + automations) and `BotScenarioEngineService.sendStepMessage` (scenarios, with its own Client lookup since scenarios must fire for cold contacts with no Client row); and on 2026-07-28, the Team/roles granular-permissions system (Phase 2) was redesigned from flat/global-per-user to per-project — a Buyer/Operator can now hold different `Permission` grants on different projects (`UserPermission` gained a `projectId` column, `@RequirePermission`/`PermissionsGuard` were retired in favor of a 5th `requiredPermissions?` param on `ProjectsService.assertAccess`, DB-backed for an immediate effect instead of waiting on JWT refresh), except `DOMAINS_*` which stays company-wide by explicit user decision (`Domain.projectId` doesn't meaningfully scope a domain to one project); a new `PROJECTS_EDIT` permission gates `PATCH /projects/:id` (archive/token-regeneration stayed `@Roles(OWNER, ADMIN)` instead of a permission, per the same decision) — see 15_PHASES.md checkboxes for current status.

## Before doing anything

Read [00_MASTER_OVERVIEW.md](00_MASTER_OVERVIEW.md) first, then the numbered doc matching the area you're touching (01-15, listed in 00's file map). Each numbered doc beyond 00 is currently a TODO stub with section headers only — fill them in as that part of the system gets built, don't let them go stale.

## Hard invariants (do not violate when writing code here)

- Every DB query that touches tenant data must be scoped by `company_id`. This is enforced at the middleware level, not by convention — if you add a new table or query path, it must go through that scoping.
- Channels (Telegram, WhatsApp, Instagram, Viber, Email) implement one `ChannelProvider` interface. Adding a channel = new class implementing that interface, never an if/else branch in business logic.
- Tracking events (PageView, Lead, Purchase) are written to an `events` table first, then pushed to Facebook/TikTok asynchronously via queue. Never call Facebook CAPI / TikTok Events API synchronously from the request path.
- All pushes go through BullMQ queues with rate limiting (30 msg/sec for Telegram). Never send a push directly.
- Every external/idempotent-sensitive request carries an `idempotency_key`.
- No hard deletes — every delete is `deleted_at` soft delete. Exceptions (documented deviations, not oversights): `Channel` has no `deletedAt` column; its "delete" is `isActive: false` (bot/webhook torn down, row kept). `Domain` also has no `deletedAt` column; its "delete" is a genuine hard delete (`domain` hostname is globally `@unique` — soft-deleting would permanently block re-adding the same hostname later). `TeamInvite` also has no `deletedAt` column; it's a transient token/credential (like `RefreshToken`, also hard-deleted on logout), not tenant data — revoking one is a genuine hard delete. All three are excluded from the `PrismaService` tenant-scoping middleware's `modelsWithCompany` list for the same reason — that middleware auto-injects `deletedAt: null` into every read, which would throw `Unknown argument` against any of them.

## Shared choke points — check before changing

These are places where multiple independent consumers rely on one piece of code staying
consistent. If you're editing one, grep for the others before you ship.

- **`modelsWithCompany` array** (`apps/api/src/prisma/prisma.service.ts`) — the tenant-scoping
  middleware only auto-injects `company_id`/`deletedAt` filters for models explicitly listed
  here (`Project`, `Landing`, `Client`, `BotScenario`, `AutomationFlow`, `AbTestGroup`,
  `StoryPost`). A new table needing tenant scoping does NOT get it automatically from having a
  `companyId` column — it must be added to this array, or every read against it is an unscoped
  cross-tenant leak.
- **`checkSubscriptionLimit`** (`apps/api/src/common/guards/subscription.util.ts`) — the single
  shared function deciding whether a company is blocked from sending pushes (plan expired,
  monthly cap, and — once Phase 4.3D ships — manually blocked/suspended by an admin). Consumed
  by both `SubscriptionGuard` (manual HTTP send) and `PushesCron.fireScheduledPushes`
  (automated). Any new "is this company allowed to push" condition belongs inside this one
  function, not as a second, divergent check bolted onto only one of its two callers.
- **`apps/admin`** (standalone Next.js app, separate from the CRM's `apps/web` — planned/being
  built per [15_PHASES.md](15_PHASES.md) §4.3, not yet fully live) is a second, cross-tenant
  consumer of core CRM services: `ProjectsService`, `ClientsService`, `PushesService`,
  `LandingsService`, `DomainsService`, `TeamService`, and the `Company` model itself. It reaches
  them either via a `runAsCompany()` helper (re-enters the tenant-scoping AsyncLocalStorage
  context with an admin-chosen target `companyId`, for the models in `modelsWithCompany`
  above) or directly (for `Domain`/`Push`/`Channel`/`User`, which already take an explicit
  `companyId` param). **When you change the signature, return shape, or scoping behavior of any
  of those services, or add/rename a `Company` field, check `apps/admin` for breakage** — it
  won't show up in `apps/web`'s tests or typecheck since it's a separate package.
- **Hand-maintained frontend enum-label dictionaries** — some Prisma enums have a matching
  `Record<EnumValue, string>` label map in `apps/web` that is NOT generated from the schema
  (e.g. `BalanceTransactionType` → `TRANSACTION_LABEL` in
  `apps/web/src/app/(dashboard)/billing/page.tsx`). Adding a new enum value in
  `prisma/schema.prisma` silently produces an undefined/missing label in the UI unless you grep
  the frontend for that enum's existing dictionary and add the new case by hand.

## Stack quick reference

Backend: NestJS 10 + Prisma 5 + PostgreSQL 16 + Redis/BullMQ. Frontend: Next.js 14 App Router + TailwindCSS/shadcn + Zustand + React Query. Telegram via Grammy.js (webhook only, no polling). WhatsApp via 360dialog. Crypto payments: USDT TRC-20 (TronGrid) / ERC-20 (Infura/Alchemy) via HD wallet, one address per payment. Full list with versions in [00_MASTER_OVERVIEW.md](00_MASTER_OVERVIEW.md).

## Doc maintenance

When a numbered doc (01-15) goes from stub to real content, also update [15_PHASES.md](15_PHASES.md) to reflect what phase actually shipped — it's the source of truth for "what's done vs planned," don't let it drift from reality.

`apps/admin` (Phase 4.3) is architecturally separate from the rest of the app and evolves
across many phases — 15_PHASES.md §4.3 is its authoritative status/plan doc; keep it current
phase-by-phase rather than writing it up only at the end.
