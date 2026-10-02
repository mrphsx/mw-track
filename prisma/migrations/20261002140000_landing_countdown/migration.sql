-- Таймер обратного отсчёта как опция любого лендинга (запрос пользователя 2026-10-02).
-- Строго аддитивно; существующие лендинги получают countdownEnabled = false, то есть ведут
-- себя ровно как раньше.
ALTER TABLE "Landing" ADD COLUMN     "countdownConfig" JSONB,
ADD COLUMN     "countdownEnabled" BOOLEAN NOT NULL DEFAULT false;
