-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "abTestGroupId" TEXT;

-- CreateIndex
CREATE INDEX "Client_abTestGroupId_idx" ON "Client"("abTestGroupId");
