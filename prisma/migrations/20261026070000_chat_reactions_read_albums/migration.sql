-- Реакции, «прочитано» (личка), альбомы в чате (2026-10-26).
ALTER TABLE "Conversation" ADD COLUMN     "peerReadOutboxMaxId" INTEGER;

ALTER TABLE "ChatMessage" ADD COLUMN     "leadReaction" TEXT,
ADD COLUMN     "mediaGroupId" TEXT,
ADD COLUMN     "ourReaction" TEXT;
