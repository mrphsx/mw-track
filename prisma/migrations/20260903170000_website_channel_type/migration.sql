-- AlterEnum
ALTER TYPE "ChannelType" ADD VALUE 'WEBSITE';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "visitorId" TEXT;

-- CreateIndex
CREATE INDEX "Client_visitorId_idx" ON "Client"("visitorId");
