-- Этапы лида в чатах (2026-10-25). Только добавление: тип, две таблицы, nullable-поле диалога, индексы.
-- CreateEnum
CREATE TYPE "ChatStageTrigger" AS ENUM ('MANUAL', 'NEW_CHAT', 'FIRST_PURCHASE', 'REPEAT_PURCHASE', 'TAG', 'FIELD');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "stageId" TEXT;

-- CreateTable
CREATE TABLE "ChatStage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#1F4E9C',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "trigger" "ChatStageTrigger" NOT NULL DEFAULT 'MANUAL',
    "purchaseNumber" INTEGER,
    "tagId" TEXT,
    "fieldId" TEXT,
    "fieldValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatStageOperator" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,

    CONSTRAINT "ChatStageOperator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatStage_projectId_idx" ON "ChatStage"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatStageOperator_stageId_userId_key" ON "ChatStageOperator"("stageId", "userId");

-- CreateIndex
CREATE INDEX "Conversation_projectId_stageId_idx" ON "Conversation"("projectId", "stageId");

-- AddForeignKey
ALTER TABLE "ChatStageOperator" ADD CONSTRAINT "ChatStageOperator_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ChatStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

