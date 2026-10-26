-- Удаление сообщения из Telegram из CRM (2026-10-26): пометка, кто и когда удалил.
ALTER TABLE "ChatMessage" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;
