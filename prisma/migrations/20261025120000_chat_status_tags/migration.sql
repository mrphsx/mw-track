-- Статусы диалогов, теги лидов и избранное в чатах (2026-10-25, как в Chatterfy). Только добавление.
-- CreateEnum
CREATE TYPE "ChatStatus" AS ENUM ('OPEN', 'WAITING', 'FINISHED');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "status" "ChatStatus" NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "ChatTag" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationTag" (
    "conversationId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationTag_pkey" PRIMARY KEY ("conversationId","tagId")
);

-- CreateTable
CREATE TABLE "ChatFavorite" (
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatFavorite_pkey" PRIMARY KEY ("userId","conversationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatTag_projectId_name_key" ON "ChatTag"("projectId", "name");

-- CreateIndex
CREATE INDEX "ConversationTag_tagId_idx" ON "ConversationTag"("tagId");

-- CreateIndex
CREATE INDEX "ChatFavorite_conversationId_idx" ON "ChatFavorite"("conversationId");

-- AddForeignKey
ALTER TABLE "ConversationTag" ADD CONSTRAINT "ConversationTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "ChatTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

