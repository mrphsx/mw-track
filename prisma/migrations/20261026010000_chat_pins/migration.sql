-- Закреплённые диалоги (2026-10-25). Только новая таблица.
-- CreateTable
CREATE TABLE "ChatPin" (
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatPin_pkey" PRIMARY KEY ("userId","conversationId")
);

-- CreateIndex
CREATE INDEX "ChatPin_conversationId_idx" ON "ChatPin"("conversationId");

