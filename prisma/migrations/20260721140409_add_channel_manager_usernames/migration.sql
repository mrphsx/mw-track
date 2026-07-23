-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "tgManagerUsernames" TEXT[] DEFAULT ARRAY[]::TEXT[];
