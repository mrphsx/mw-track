-- CreateEnum
CREATE TYPE "PersonalBroadcastStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Permission" ADD VALUE 'PERSONAL_BROADCASTS_VIEW';
ALTER TYPE "Permission" ADD VALUE 'PERSONAL_BROADCASTS_CREATE';
ALTER TYPE "Permission" ADD VALUE 'PERSONAL_BROADCASTS_SEND';
ALTER TYPE "Permission" ADD VALUE 'PERSONAL_BROADCASTS_DELETE';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "lastPurchaseAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PersonalBroadcast" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PersonalBroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "variants" JSONB NOT NULL,
    "filter" JSONB NOT NULL,
    "delayMinSeconds" INTEGER NOT NULL DEFAULT 15,
    "delayMaxSeconds" INTEGER NOT NULL DEFAULT 45,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "audienceTotal" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalBroadcastLog" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "variantIndex" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "PersonalBroadcastLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalBroadcast_projectId_idx" ON "PersonalBroadcast"("projectId");

-- CreateIndex
CREATE INDEX "PersonalBroadcast_status_scheduledAt_idx" ON "PersonalBroadcast"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "PersonalBroadcastLog_broadcastId_status_idx" ON "PersonalBroadcastLog"("broadcastId", "status");

-- AddForeignKey
ALTER TABLE "PersonalBroadcast" ADD CONSTRAINT "PersonalBroadcast_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalBroadcastLog" ADD CONSTRAINT "PersonalBroadcastLog_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "PersonalBroadcast"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalBroadcastLog" ADD CONSTRAINT "PersonalBroadcastLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

