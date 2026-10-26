-- Трафик напрямую в бота (BotLink, Channel.tgDirectTraffic, Client.botLinkId) и встроенный чат
-- (Conversation, ChatMessage), запрос пользователя 2026-10-23. Только добавления: новые таблицы,
-- nullable-колонка и boolean с константным дефолтом (мгновенно в PG 11+), существующие данные не трогаются.

-- CreateEnum
CREATE TYPE "BotLinkSource" AS ENUM ('FACEBOOK', 'TIKTOK', 'TELEGRAM_ADS', 'OTHER');

-- CreateEnum
CREATE TYPE "ConversationSource" AS ENUM ('BOT', 'PERSONAL');

-- CreateEnum
CREATE TYPE "ChatDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "ChatSenderType" AS ENUM ('CLIENT', 'OPERATOR', 'BOT');

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "tgDirectTraffic" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "botLinkId" TEXT;

-- CreateTable
CREATE TABLE "BotLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "source" "BotLinkSource" NOT NULL DEFAULT 'OTHER',
    "buyerId" TEXT,
    "pixelId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BotLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "source" "ConversationSource" NOT NULL DEFAULT 'BOT',
    "peerId" TEXT NOT NULL,
    "clientId" TEXT,
    "peerFirstName" TEXT,
    "peerLastName" TEXT,
    "peerUsername" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageText" TEXT,
    "lastMessageDirection" "ChatDirection",
    "lastIncomingAt" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "ChatDirection" NOT NULL,
    "senderType" "ChatSenderType" NOT NULL,
    "senderUserId" TEXT,
    "text" TEXT,
    "mediaType" TEXT,
    "mediaFileId" TEXT,
    "mediaFileName" TEXT,
    "externalId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotLink_code_key" ON "BotLink"("code");

-- CreateIndex
CREATE INDEX "BotLink_projectId_idx" ON "BotLink"("projectId");

-- CreateIndex
CREATE INDEX "Conversation_companyId_lastMessageAt_idx" ON "Conversation"("companyId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_projectId_lastMessageAt_idx" ON "Conversation"("projectId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_clientId_idx" ON "Conversation"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_channelId_source_peerId_key" ON "Conversation"("channelId", "source", "peerId");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Client_botLinkId_idx" ON "Client"("botLinkId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_botLinkId_fkey" FOREIGN KEY ("botLinkId") REFERENCES "BotLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotLink" ADD CONSTRAINT "BotLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

