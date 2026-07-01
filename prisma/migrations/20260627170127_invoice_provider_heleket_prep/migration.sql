-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "gatewayUuid" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'SELF_HOSTED';
