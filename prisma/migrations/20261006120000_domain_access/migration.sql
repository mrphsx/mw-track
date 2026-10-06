-- Доступ к доменам по сотрудникам (запрос пользователя 2026-10-06).
-- sharedWithAllBuyers DEFAULT true — ровно требование "те домены что уже есть, пусть останутся
-- доступны сразу для всех баеров": все существующие строки получают true, поведение для них не
-- меняется. Строго аддитивно.
-- Прим.: `prisma migrate diff` заодно выводит не связанный с этой миграцией дрейф по
-- PersonalBroadcastLog_clientId_fkey (расходится с БД с 2026-08-06) — он сюда сознательно
-- не включён.

-- AlterTable
ALTER TABLE "Domain" ADD COLUMN     "sharedWithAllBuyers" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "DomainAccess" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DomainAccess_userId_idx" ON "DomainAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DomainAccess_domainId_userId_key" ON "DomainAccess"("domainId", "userId");

-- AddForeignKey
ALTER TABLE "DomainAccess" ADD CONSTRAINT "DomainAccess_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainAccess" ADD CONSTRAINT "DomainAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
