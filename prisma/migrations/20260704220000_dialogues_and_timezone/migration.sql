-- Диалоги с клиентами + часовой пояс проекта (запрос пользователя 2026-07-04).
ALTER TABLE "Project" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';

ALTER TABLE "Client" ADD COLUMN "firstDialogueAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN "lastDialogueAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN "dialogueMessageCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Channel" ADD COLUMN "tgPersonalPhone" TEXT;
ALTER TABLE "Channel" ADD COLUMN "tgPersonalUserId" TEXT;
ALTER TABLE "Channel" ADD COLUMN "tgSessionEncrypted" TEXT;
