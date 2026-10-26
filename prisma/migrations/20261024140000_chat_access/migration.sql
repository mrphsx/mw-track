-- Доступ к встроенному чату по сотрудникам (запрос пользователя 2026-10-24). Константный дефолт
-- ALL — мгновенно в PG 11+ и сохраняет текущий доступ админов и операторов; баерам чат закрыт
-- в коде независимо от значения.
CREATE TYPE "ChatAccess" AS ENUM ('NONE', 'BOT', 'PERSONAL', 'ALL');

ALTER TABLE "User" ADD COLUMN "chatAccess" "ChatAccess" NOT NULL DEFAULT 'ALL';
