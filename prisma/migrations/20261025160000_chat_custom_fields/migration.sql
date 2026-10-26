-- Свои поля лида в чатах (2026-10-25, как в Chatterfy). Только добавление: тип, таблица, nullable JSON-поле.
-- CreateEnum
CREATE TYPE "ChatFieldType" AS ENUM ('TEXT', 'LONG_TEXT', 'LINK', 'NUMBER', 'DATE', 'SELECT', 'MULTISELECT');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "customFields" JSONB;

-- CreateTable
CREATE TABLE "ChatCustomField" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ChatFieldType" NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatCustomField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatCustomField_projectId_idx" ON "ChatCustomField"("projectId");

