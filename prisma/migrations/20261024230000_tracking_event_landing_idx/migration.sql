-- Индекс для подсчёта PageView/Lead по лендингу (жалоба 2026-10-24: страница лендинга ждала
-- статистику до ~8 с). landingId хранится внутри JSON payload, поэтому индекс по выражению —
-- Prisma не умеет описать его в schema.prisma, он существует только здесь. Используется
-- LandingsService.countLandingEvents — условие запроса должно совпадать с выражением индекса.
-- На проде создан заранее через CREATE INDEX CONCURRENTLY (без блокировки записи событий),
-- миграция отмечена применённой через `prisma migrate resolve --applied`.
CREATE INDEX IF NOT EXISTS "TrackingEvent_projectId_eventName_landingId_idx" ON "TrackingEvent" ("projectId", "eventName", ((payload->>'landingId')));
