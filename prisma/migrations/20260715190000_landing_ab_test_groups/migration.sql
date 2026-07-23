-- A/B/n-тестирование лендингов: замена парной модели (Landing.abTestVariantId, 1:1) на
-- групповую (AbTestGroup + Landing.abTestGroupId/abTestWeight), запрос пользователя
-- 2026-07-15. Ни один тест ещё не был запущен в проде (abTestEnabled=true count == 0
-- на момент миграции) — старые колонки дропаются без переноса данных.

ALTER TABLE "Landing" DROP CONSTRAINT "Landing_abTestVariantId_fkey";
DROP INDEX "Landing_abTestVariantId_key";
ALTER TABLE "Landing" DROP COLUMN "abTestEnabled";
ALTER TABLE "Landing" DROP COLUMN "abTestRatio";
ALTER TABLE "Landing" DROP COLUMN "abTestVariantId";

CREATE TABLE "AbTestGroup" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AbTestGroup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AbTestGroup_projectId_idx" ON "AbTestGroup"("projectId");

ALTER TABLE "AbTestGroup" ADD CONSTRAINT "AbTestGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Landing" ADD COLUMN "abTestGroupId" TEXT;
ALTER TABLE "Landing" ADD COLUMN "abTestWeight" INTEGER;

CREATE INDEX "Landing_abTestGroupId_idx" ON "Landing"("abTestGroupId");

ALTER TABLE "Landing" ADD CONSTRAINT "Landing_abTestGroupId_fkey" FOREIGN KEY ("abTestGroupId") REFERENCES "AbTestGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
