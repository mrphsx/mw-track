-- Кто создал рассылку (2026-10-28).
-- AlterTable
ALTER TABLE "Push" ADD COLUMN     "createdById" TEXT;

-- CreateIndex
CREATE INDEX "Push_createdById_idx" ON "Push"("createdById");

-- AddForeignKey
ALTER TABLE "Push" ADD CONSTRAINT "Push_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
