-- Кэш переводов сообщений чата (2026-10-24). Nullable-колонка без дефолта — мгновенно.
-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "translations" JSONB;

