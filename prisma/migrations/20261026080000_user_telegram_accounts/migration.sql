-- Вход в CRM из мини-аппа Telegram (бот оповещений компании), 2026-10-26.
-- CreateTable
CREATE TABLE "UserTelegramAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tgUserId" TEXT,
    "username" TEXT,
    "tgFirstName" TEXT,
    "linkToken" TEXT,
    "linkTokenExpiresAt" TIMESTAMP(3),
    "linkedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTelegramAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserTelegramAccount_linkToken_key" ON "UserTelegramAccount"("linkToken");

-- CreateIndex
CREATE INDEX "UserTelegramAccount_companyId_username_idx" ON "UserTelegramAccount"("companyId", "username");

-- CreateIndex
CREATE INDEX "UserTelegramAccount_userId_idx" ON "UserTelegramAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTelegramAccount_companyId_tgUserId_key" ON "UserTelegramAccount"("companyId", "tgUserId");

-- AddForeignKey
ALTER TABLE "UserTelegramAccount" ADD CONSTRAINT "UserTelegramAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

