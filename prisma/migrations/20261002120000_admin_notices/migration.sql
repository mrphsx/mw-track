-- Объявления супер-админа в колокол оповещений СРМ (запрос пользователя 2026-10-02).
-- Строго аддитивно: две новые таблицы, существующие не затрагиваются.
-- Прим.: `prisma migrate diff` заодно выводит не связанный с этой миграцией дрейф по
-- PersonalBroadcastLog_clientId_fkey (существует в БД иначе, чем в схеме, ещё с 2026-08-06) —
-- он сознательно НЕ включён здесь, это отдельная тема.

-- CreateTable
CREATE TABLE "AdminNotice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNoticeRead" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),

    CONSTRAINT "AdminNoticeRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminNotice_companyId_createdAt_idx" ON "AdminNotice"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminNotice_createdAt_idx" ON "AdminNotice"("createdAt");

-- CreateIndex
CREATE INDEX "AdminNoticeRead_userId_idx" ON "AdminNoticeRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminNoticeRead_noticeId_userId_key" ON "AdminNoticeRead"("noticeId", "userId");

-- AddForeignKey
ALTER TABLE "AdminNotice" ADD CONSTRAINT "AdminNotice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotice" ADD CONSTRAINT "AdminNotice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNoticeRead" ADD CONSTRAINT "AdminNoticeRead_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "AdminNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNoticeRead" ADD CONSTRAINT "AdminNoticeRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
