-- Счётчик реально отфильтрованных ботов (запрос пользователя 2026-09-25) — денормализованный,
-- инкрементируется в CloakingService.applyCloaking при любом реально сработавшем правиле
-- клоакинга (не только с условием BOT), если сам визит похож на бота.
ALTER TABLE "Landing" ADD COLUMN "botsFilteredCount" INTEGER NOT NULL DEFAULT 0;
