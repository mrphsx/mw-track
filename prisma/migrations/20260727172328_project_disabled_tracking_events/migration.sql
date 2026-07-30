-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "disabledTrackingEvents" TEXT[] DEFAULT ARRAY[]::TEXT[];
