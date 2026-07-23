-- Пуши падали с "chat not found" для клиентов, у которых firstDialogueAt пришёл от личного
-- MTProto-аккаунта (TelegramPersonalService), а не от бота (TelegramProvider) — у бота с ними
-- никогда не было чата, но firstDialogueAt был общим полем на оба источника. botActivatedAt
-- ставится только когда сообщение реально пришло через бота — единственный надёжный сигнал
-- "бот технически может прислать пуш". Запрос пользователя 2026-07-17.
ALTER TABLE "Client" ADD COLUMN "botActivatedAt" TIMESTAMP(3);
