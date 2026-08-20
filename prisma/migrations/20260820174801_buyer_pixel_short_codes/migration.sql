-- AlterTable
ALTER TABLE "User" ADD COLUMN     "buyerShortCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_buyerShortCode_key" ON "User"("buyerShortCode");

-- AlterTable
ALTER TABLE "TrackingPixel" ADD COLUMN     "shortCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TrackingPixel_shortCode_key" ON "TrackingPixel"("shortCode");
