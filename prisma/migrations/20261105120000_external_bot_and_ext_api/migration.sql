-- Бот на внешней платформе и единый API событий (2026-11-05).
-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "tgBotExternal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "externalId" TEXT;

-- CreateTable
CREATE TABLE "ExternalApiLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "eventId" TEXT,
    "type" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "clientId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalApiLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalApiLog_projectId_createdAt_idx" ON "ExternalApiLog"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalApiLog_projectId_eventId_key" ON "ExternalApiLog"("projectId", "eventId");

-- CreateIndex
CREATE INDEX "Client_projectId_externalId_idx" ON "Client"("projectId", "externalId");

