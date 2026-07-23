-- Team Analytics (Фаза 3.6, запрос пользователя 2026-07-15) — атрибуция клиента к баеру через
-- скрытый query-параметр трекинг-ссылки (см. link-params.ts buyerRef), не через привязку к
-- лендингу. Мягкая ссылка на User.id, без FK — тот же принцип, что и у Client.pixelId.
ALTER TABLE "Client" ADD COLUMN "buyerId" TEXT;
