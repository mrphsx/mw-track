-- CreateEnum
CREATE TYPE "LandingsVisibilityScope" AS ENUM ('OWN_LANDINGS', 'PROJECT_LANDINGS', 'ALL_LANDINGS');

-- AlterTable
ALTER TABLE "Landing" ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "TrackingPixel" ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "landingsVisibilityScope" "LandingsVisibilityScope" NOT NULL DEFAULT 'PROJECT_LANDINGS';

-- AddForeignKey
ALTER TABLE "Landing" ADD CONSTRAINT "Landing_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingPixel" ADD CONSTRAINT "TrackingPixel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill (запрос пользователя 2026-08-03: "пусть у текущих лэндингов создателем будет овнер
-- команды") — у уже существующих лендингов/пикселей нет автора, проставляем самым старым
-- активным Owner компании. Для TrackingPixel companyId только через Project, поэтому JOIN.
UPDATE "Landing" l SET "createdById" = (
  SELECT u.id FROM "User" u
  WHERE u."companyId" = l."companyId" AND u.role = 'OWNER' AND u."deletedAt" IS NULL
  ORDER BY u."createdAt" ASC LIMIT 1
) WHERE l."createdById" IS NULL;

UPDATE "TrackingPixel" p SET "createdById" = (
  SELECT u.id FROM "User" u JOIN "Project" pr ON pr."companyId" = u."companyId"
  WHERE pr.id = p."projectId" AND u.role = 'OWNER' AND u."deletedAt" IS NULL
  ORDER BY u."createdAt" ASC LIMIT 1
) WHERE p."createdById" IS NULL;
