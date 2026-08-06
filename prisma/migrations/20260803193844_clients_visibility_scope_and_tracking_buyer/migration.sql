-- CreateEnum
CREATE TYPE "ClientsVisibilityScope" AS ENUM ('ALL_CLIENTS', 'OWN_CLIENTS');

-- AlterTable
ALTER TABLE "TrackingEvent" ADD COLUMN     "buyerId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clientsVisibilityScope" "ClientsVisibilityScope" NOT NULL DEFAULT 'ALL_CLIENTS';

-- CreateIndex
CREATE INDEX "TrackingEvent_projectId_buyerId_idx" ON "TrackingEvent"("projectId", "buyerId");
