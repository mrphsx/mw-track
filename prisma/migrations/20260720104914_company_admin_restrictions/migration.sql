-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "domainsBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSuspended" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pushesBlocked" BOOLEAN NOT NULL DEFAULT false;
