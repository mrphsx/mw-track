-- Тимлид и назначение диалогов операторам, авто-распределение (запрос пользователя 2026-10-25).
-- Только добавление: новое значение enum, два nullable-поля, новая таблица, индексы.
-- AlterEnum
ALTER TYPE "ChatSenderType" ADD VALUE 'SYSTEM';

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedUserId" TEXT;

-- CreateTable
CREATE TABLE "ChatAutoAssignRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatAutoAssignRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatAutoAssignRule_projectId_resource_idx" ON "ChatAutoAssignRule"("projectId", "resource");

-- CreateIndex
CREATE UNIQUE INDEX "ChatAutoAssignRule_projectId_resource_userId_key" ON "ChatAutoAssignRule"("projectId", "resource", "userId");

-- CreateIndex
CREATE INDEX "Conversation_assignedUserId_idx" ON "Conversation"("assignedUserId");

