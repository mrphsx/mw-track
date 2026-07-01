-- AlterTable
ALTER TABLE "Domain" DROP COLUMN "cfRecordId",
DROP COLUMN "cfZoneId",
ADD COLUMN     "lastCheckError" TEXT;
