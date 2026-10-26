-- Ответ, пересланное, правка сообщений чата (2026-10-26).
ALTER TABLE "ChatMessage" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "forwardedFrom" TEXT,
ADD COLUMN     "originalText" TEXT,
ADD COLUMN     "replyToId" TEXT;
