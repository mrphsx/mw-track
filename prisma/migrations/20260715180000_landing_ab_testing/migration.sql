-- A/B-тестирование лендингов (Фаза 3.2, запрос пользователя 2026-07-15).
ALTER TABLE "Landing" ADD COLUMN "abTestEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Landing" ADD COLUMN "abTestRatio" INTEGER;
ALTER TABLE "Landing" ADD COLUMN "abTestVariantId" TEXT;

CREATE UNIQUE INDEX "Landing_abTestVariantId_key" ON "Landing"("abTestVariantId");

ALTER TABLE "Landing" ADD CONSTRAINT "Landing_abTestVariantId_fkey" FOREIGN KEY ("abTestVariantId") REFERENCES "Landing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
