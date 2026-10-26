-- Варианты, интервал и фильтр у рассылки из чата (2026-10-25). Только добавление полей.
-- AlterTable
ALTER TABLE "ChatBroadcast" ADD COLUMN     "delayMaxSec" INTEGER,
ADD COLUMN     "delayMinSec" INTEGER,
ADD COLUMN     "filter" JSONB,
ADD COLUMN     "variants" JSONB;

-- AlterTable
ALTER TABLE "ChatBroadcastRecipient" ADD COLUMN     "variant" INTEGER NOT NULL DEFAULT 0;

