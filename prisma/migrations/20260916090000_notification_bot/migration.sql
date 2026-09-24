-- CreateTable
CREATE TABLE "NotificationBot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tgBotId" TEXT NOT NULL,
    "tgBotUsername" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationBot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRecipient" (
    "id" TEXT NOT NULL,
    "notificationBotId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "chatId" TEXT,
    "linkedAt" TIMESTAMP(3),
    "enabledTypes" TEXT[],
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAlertState" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "activeSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationAlertState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationBot_companyId_key" ON "NotificationBot"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationBot_tgBotId_key" ON "NotificationBot"("tgBotId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRecipient_notificationBotId_username_key" ON "NotificationRecipient"("notificationBotId", "username");

-- CreateIndex
CREATE INDEX "NotificationAlertState_companyId_idx" ON "NotificationAlertState"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationAlertState_companyId_type_subjectId_key" ON "NotificationAlertState"("companyId", "type", "subjectId");

-- AddForeignKey
ALTER TABLE "NotificationBot" ADD CONSTRAINT "NotificationBot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_notificationBotId_fkey" FOREIGN KEY ("notificationBotId") REFERENCES "NotificationBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
