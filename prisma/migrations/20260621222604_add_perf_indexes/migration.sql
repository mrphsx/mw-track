-- Для поиска клиентов по фильтрам пушей
CREATE INDEX idx_clients_push_filter ON "Client"
  ("projectId", "isBotActive", "isSubscribed", "hasPurchase", "channelType");

-- Для аналитики по времени
CREATE INDEX idx_events_project_time ON "TrackingEvent"
  ("projectId", "eventName", "eventTime" DESC);

-- Для поиска по fbclid (связка лендинг → Telegram)
CREATE INDEX idx_clients_fbclid ON "Client" ("fbclid")
  WHERE "fbclid" IS NOT NULL;
