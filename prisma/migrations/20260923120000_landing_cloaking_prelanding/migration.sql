-- Расширяемый клоакинг (запрос пользователя 2026-09-23, "дальше клоакинг будет сильно
-- расширяться") — текущее поведение (редирект на внешний URL) становится типом REDIRECT,
-- новый тип PRELANDING отдаёт заранее загруженную статическую white page с того же домена
-- вместо редиректа. DEFAULT 'REDIRECT' переводит все уже существующие cloakingEnabled=true
-- записи на текущее поведение без ручного бэкфилла.
CREATE TYPE "CloakingType" AS ENUM ('REDIRECT', 'PRELANDING');
ALTER TABLE "Landing" ADD COLUMN "cloakingType" "CloakingType" NOT NULL DEFAULT 'REDIRECT';
ALTER TABLE "Landing" ADD COLUMN "cloakingPrelandingBasePath" TEXT;
