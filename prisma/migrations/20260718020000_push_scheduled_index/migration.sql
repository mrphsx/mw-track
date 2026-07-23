-- Индекс под скан крона отложенных рассылок (status='SCHEDULED' AND scheduledAt<=now()) —
-- запрос пользователя 2026-07-18 "программировать рассылки на потом". Чисто аддитивно.
CREATE INDEX "Push_status_scheduledAt_idx" ON "Push"("status", "scheduledAt");
