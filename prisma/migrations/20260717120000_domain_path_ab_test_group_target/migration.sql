-- Домен/путь теперь может указывать либо на один лендинг (рендерится строго он, без сплита),
-- либо напрямую на AbTestGroup (сплит применяется всегда) — запрос пользователя 2026-07-17:
-- нужна возможность лить и на группу теста целиком, и на конкретный вариант отдельно, что
-- невозможно, пока сплит был неявным свойством самого лендинга.

ALTER TABLE "DomainPath" ALTER COLUMN "landingId" DROP NOT NULL;
ALTER TABLE "DomainPath" ADD COLUMN "abTestGroupId" TEXT;

CREATE INDEX "DomainPath_abTestGroupId_idx" ON "DomainPath"("abTestGroupId");

ALTER TABLE "DomainPath" ADD CONSTRAINT "DomainPath_abTestGroupId_fkey" FOREIGN KEY ("abTestGroupId") REFERENCES "AbTestGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ровно одно из двух — существующие строки (landingId задан, abTestGroupId ещё NULL) уже
-- удовлетворяют условию, бэкфилл не нужен.
ALTER TABLE "DomainPath" ADD CONSTRAINT "DomainPath_one_target_check" CHECK (("landingId" IS NOT NULL) != ("abTestGroupId" IS NOT NULL));

ALTER TABLE "AbTestGroup" ADD COLUMN "name" TEXT;
