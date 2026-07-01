-- Один домен -> много лендингов/проектов через путь. Заменяет Domain.landingId
-- (1 домен = 1 лендинг на корне) на таблицу DomainPath (N путей на домен).
CREATE TABLE "DomainPath" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "landingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DomainPath_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DomainPath_domainId_path_key" ON "DomainPath"("domainId", "path");
CREATE INDEX "DomainPath_domainId_idx" ON "DomainPath"("domainId");

ALTER TABLE "DomainPath" ADD CONSTRAINT "DomainPath_domainId_fkey"
    FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DomainPath" ADD CONSTRAINT "DomainPath_landingId_fkey"
    FOREIGN KEY ("landingId") REFERENCES "Landing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Переносим существующие прямые привязки (домен -> один лендинг на корне) в path="/",
-- чтобы уже работающие домены не отвалились после миграции.
INSERT INTO "DomainPath" ("id", "domainId", "path", "landingId", "createdAt", "updatedAt")
SELECT 'mig_' || "id", "id", '/', "landingId", "createdAt", "updatedAt"
FROM "Domain"
WHERE "landingId" IS NOT NULL;

ALTER TABLE "Domain" DROP CONSTRAINT IF EXISTS "Domain_landingId_fkey";
ALTER TABLE "Domain" DROP COLUMN "landingId";
