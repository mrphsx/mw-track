-- Задержка одобрения заявки на вступление (PRIVATE_CHANNEL_REQUEST), секунды.
-- null/0 — без задержки (текущее поведение).
ALTER TABLE "Channel" ADD COLUMN "tgJoinDelaySeconds" INTEGER;
