-- Рассылка из чата (2026-10-25). Только новые типы и таблицы.
-- CreateEnum
CREATE TYPE "ChatBroadcastStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChatBroadcastRecipientStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "ChatBroadcast" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "text" TEXT,
    "templateId" TEXT,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" "ChatBroadcastStatus" NOT NULL DEFAULT 'PENDING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ChatBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatBroadcastRecipient" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "ChatBroadcastRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ChatBroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatBroadcast_status_sendAt_idx" ON "ChatBroadcast"("status", "sendAt");

-- CreateIndex
CREATE INDEX "ChatBroadcast_projectId_createdAt_idx" ON "ChatBroadcast"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatBroadcastRecipient_broadcastId_status_idx" ON "ChatBroadcastRecipient"("broadcastId", "status");

-- AddForeignKey
ALTER TABLE "ChatBroadcastRecipient" ADD CONSTRAINT "ChatBroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "ChatBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

