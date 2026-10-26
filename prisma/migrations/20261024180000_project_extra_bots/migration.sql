-- Дополнительные боты проекта (запрос пользователя 2026-10-24): ProjectBot, ProjectBotSubscriber,
-- Conversation.botKey. Только добавления. Старый уникальный индекс диалогов (channelId, source, peerId)
-- здесь НЕ удаляется: работающая до перезапуска версия API делает по нему upsert. Его удаляет
-- следующая миграция, применяемая уже после выкладки кода с новым ключом.


-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "botKey" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ProjectBot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tgBotToken" TEXT NOT NULL,
    "tgBotId" TEXT NOT NULL,
    "tgBotUsername" TEXT,
    "tgBotFirstName" TEXT,
    "tgAvatarFileId" TEXT,
    "tgManagerUsernames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "lastWebhookAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectBot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBotSubscriber" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "tgUserId" TEXT NOT NULL,
    "tgUsername" TEXT,
    "tgFirstName" TEXT,
    "tgLastName" TEXT,
    "clientId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectBotSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectBot_projectId_idx" ON "ProjectBot"("projectId");

-- CreateIndex
CREATE INDEX "ProjectBotSubscriber_clientId_idx" ON "ProjectBotSubscriber"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBotSubscriber_botId_tgUserId_key" ON "ProjectBotSubscriber"("botId", "tgUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_channelId_source_botKey_peerId_key" ON "Conversation"("channelId", "source", "botKey", "peerId");

-- AddForeignKey
ALTER TABLE "ProjectBot" ADD CONSTRAINT "ProjectBot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBotSubscriber" ADD CONSTRAINT "ProjectBotSubscriber_botId_fkey" FOREIGN KEY ("botId") REFERENCES "ProjectBot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

