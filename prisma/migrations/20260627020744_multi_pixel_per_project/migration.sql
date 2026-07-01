/*
  Warnings:

  - You are about to drop the column `fbAccessToken` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `fbPixelId` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `fbTestEventCode` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `ttAccessToken` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `ttPixelId` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `fbError` on the `TrackingEvent` table. All the data in the column will be lost.
  - You are about to drop the column `fbEventId` on the `TrackingEvent` table. All the data in the column will be lost.
  - You are about to drop the column `fbSentAt` on the `TrackingEvent` table. All the data in the column will be lost.
  - You are about to drop the column `fbStatus` on the `TrackingEvent` table. All the data in the column will be lost.
  - You are about to drop the column `ttError` on the `TrackingEvent` table. All the data in the column will be lost.
  - You are about to drop the column `ttSentAt` on the `TrackingEvent` table. All the data in the column will be lost.
  - You are about to drop the column `ttStatus` on the `TrackingEvent` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "PixelPlatform" AS ENUM ('FACEBOOK', 'TIKTOK');

-- DropIndex
DROP INDEX "idx_clients_push_filter";

-- DropIndex
DROP INDEX "idx_events_project_time";

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "fbAccessToken",
DROP COLUMN "fbPixelId",
DROP COLUMN "fbTestEventCode",
DROP COLUMN "ttAccessToken",
DROP COLUMN "ttPixelId";

-- AlterTable
ALTER TABLE "TrackingEvent" DROP COLUMN "fbError",
DROP COLUMN "fbEventId",
DROP COLUMN "fbSentAt",
DROP COLUMN "fbStatus",
DROP COLUMN "ttError",
DROP COLUMN "ttSentAt",
DROP COLUMN "ttStatus";

-- CreateTable
CREATE TABLE "TrackingPixel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "platform" "PixelPlatform" NOT NULL,
    "label" TEXT,
    "pixelId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "testEventCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingPixel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingEventDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "pixelId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "externalEventId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingEventDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackingPixel_projectId_idx" ON "TrackingPixel"("projectId");

-- CreateIndex
CREATE INDEX "TrackingEventDelivery_eventId_idx" ON "TrackingEventDelivery"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingEventDelivery_eventId_pixelId_key" ON "TrackingEventDelivery"("eventId", "pixelId");

-- AddForeignKey
ALTER TABLE "TrackingPixel" ADD CONSTRAINT "TrackingPixel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEventDelivery" ADD CONSTRAINT "TrackingEventDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TrackingEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEventDelivery" ADD CONSTRAINT "TrackingEventDelivery_pixelId_fkey" FOREIGN KEY ("pixelId") REFERENCES "TrackingPixel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
