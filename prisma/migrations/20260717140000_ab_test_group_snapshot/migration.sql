-- Сохранение статистики завершённых A/B/n-тестов (запрос пользователя 2026-07-17) — раньше
-- остановка теста сразу soft-delete'ила группу, статистика нигде не сохранялась.
ALTER TABLE "AbTestGroup" ADD COLUMN "endedAt" TIMESTAMP(3);
ALTER TABLE "AbTestGroup" ADD COLUMN "resultsSnapshot" JSONB;
