-- Шаблоны ответов с папками и отложенные сообщения в чатах (2026-10-25, как в Chatterfy). Только новые таблицы.
-- CreateEnum
CREATE TYPE "ChatScheduledStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ChatTemplateFolder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatTemplateFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT,
    "mediaKind" TEXT,
    "mediaKey" TEXT,
    "mediaFileName" TEXT,
    "mediaMime" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatScheduledMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "text" TEXT,
    "templateId" TEXT,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" "ChatScheduledStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatScheduledMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatTemplateFolder_companyId_idx" ON "ChatTemplateFolder"("companyId");

-- CreateIndex
CREATE INDEX "ChatTemplate_folderId_idx" ON "ChatTemplate"("folderId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatTemplate_companyId_code_key" ON "ChatTemplate"("companyId", "code");

-- CreateIndex
CREATE INDEX "ChatScheduledMessage_status_sendAt_idx" ON "ChatScheduledMessage"("status", "sendAt");

-- CreateIndex
CREATE INDEX "ChatScheduledMessage_conversationId_idx" ON "ChatScheduledMessage"("conversationId");

-- AddForeignKey
ALTER TABLE "ChatTemplate" ADD CONSTRAINT "ChatTemplate_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "ChatTemplateFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

