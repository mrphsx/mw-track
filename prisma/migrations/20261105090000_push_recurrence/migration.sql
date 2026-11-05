-- Регулярные рассылки по расписанию (2026-11-05).
-- AlterTable
ALTER TABLE "Push" ADD COLUMN     "recurrenceId" TEXT;

-- CreateTable
CREATE TABLE "PushRecurrence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT,
    "name" TEXT NOT NULL,
    "messageText" TEXT NOT NULL,
    "messageMedia" JSONB,
    "buttons" JSONB,
    "filter" JSONB NOT NULL,
    "projectIds" TEXT[],
    "days" JSONB NOT NULL,
    "timezone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastRunError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushRecurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushRecurrence_companyId_idx" ON "PushRecurrence"("companyId");

-- CreateIndex
CREATE INDEX "PushRecurrence_isActive_nextRunAt_idx" ON "PushRecurrence"("isActive", "nextRunAt");

-- CreateIndex
CREATE INDEX "Push_recurrenceId_idx" ON "Push"("recurrenceId");

-- AddForeignKey
ALTER TABLE "Push" ADD CONSTRAINT "Push_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "PushRecurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
