-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "sweepError" TEXT,
ADD COLUMN     "sweepTxHash" TEXT,
ADD COLUMN     "sweptAt" TIMESTAMP(3);
