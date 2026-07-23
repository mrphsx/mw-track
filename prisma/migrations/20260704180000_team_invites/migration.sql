-- Инвайт-ссылки в команду (запрос пользователя 2026-07-04) — токен = единственная авторизация
-- принятия приглашения, нет deletedAt (транзитный креденшл, revoke — хард-делит, как RefreshToken).
CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "projectIds" JSONB,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamInvite_token_key" ON "TeamInvite"("token");
CREATE INDEX "TeamInvite_companyId_idx" ON "TeamInvite"("companyId");

ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
