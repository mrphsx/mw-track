-- Получатель опознаётся по tgUserId, юзернейм становится необязательной подписью.
ALTER TABLE "NotificationRecipient" ALTER COLUMN "username" DROP NOT NULL;
ALTER TABLE "NotificationRecipient" ADD COLUMN "tgUserId" TEXT;
ALTER TABLE "NotificationRecipient" ADD COLUMN "tgFirstName" TEXT;
ALTER TABLE "NotificationRecipient" ADD COLUMN "profileCheckedAt" TIMESTAMP(3);

-- Для уже привязанных: id личного чата и есть id пользователя.
UPDATE "NotificationRecipient" SET "tgUserId" = "chatId" WHERE "chatId" IS NOT NULL;

DROP INDEX "NotificationRecipient_notificationBotId_username_key";
CREATE UNIQUE INDEX "NotificationRecipient_notificationBotId_tgUserId_key" ON "NotificationRecipient"("notificationBotId", "tgUserId");
CREATE INDEX "NotificationRecipient_notificationBotId_username_idx" ON "NotificationRecipient"("notificationBotId", "username");
