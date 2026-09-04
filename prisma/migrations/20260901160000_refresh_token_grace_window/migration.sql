-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "RefreshToken_supersededAt_idx" ON "RefreshToken"("supersededAt");
