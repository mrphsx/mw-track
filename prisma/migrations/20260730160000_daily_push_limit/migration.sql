-- Рассылки переведены с помесячного лимита на дневной (запрос пользователя 2026-07-30:
-- "поменять саму подписку, пусть будет по проектам, клиентам, рассылок В ДЕНЬ").
-- RENAME COLUMN, не DROP+ADD — существующие значения (сколько уже отправлено в текущем
-- окне) остаются валидными числами и для дневного окна, следующий тик PushesCron
-- (resetDailyPushLimits) просто сбросит их раньше, чем раньше.
ALTER TABLE "Company" RENAME COLUMN "maxPushesPerMonth" TO "maxPushesPerDay";
ALTER TABLE "Company" RENAME COLUMN "pushesThisMonth" TO "pushesToday";
ALTER TABLE "Company" ALTER COLUMN "maxPushesPerDay" SET DEFAULT 2;
