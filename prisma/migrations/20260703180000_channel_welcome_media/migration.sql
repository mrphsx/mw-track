-- Медиа и кнопки для приветственного сообщения бота (PRIVATE_CHANNEL_REQUEST) — запрос
-- пользователя 2026-07-03. tgWelcomeMessage (текст) уже существовал.
ALTER TABLE "Channel" ADD COLUMN "tgWelcomeMediaType" TEXT;
ALTER TABLE "Channel" ADD COLUMN "tgWelcomeMediaKey" TEXT;
ALTER TABLE "Channel" ADD COLUMN "tgWelcomeButtons" JSONB;
