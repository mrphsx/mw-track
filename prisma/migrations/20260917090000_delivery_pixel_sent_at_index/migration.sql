-- На боевой базе индекс создан заранее через CREATE INDEX CONCURRENTLY (таблица большая и пишется
-- постоянно — обычный CREATE INDEX заблокировал бы запись доставок). IF NOT EXISTS делает эту
-- миграцию безвредной там и полноценной на новой базе.
CREATE INDEX IF NOT EXISTS "TrackingEventDelivery_pixelId_sentAt_idx" ON "TrackingEventDelivery"("pixelId", "sentAt");
