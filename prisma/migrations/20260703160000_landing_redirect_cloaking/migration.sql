-- Авторедирект (без клика по кнопке) и клоакинг по странам (allow-list + fallback-ссылка
-- для не-разрешённых стран) — новые опции лендинга, запрос пользователя 2026-07-03.
ALTER TABLE "Landing" ADD COLUMN "autoRedirect" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Landing" ADD COLUMN "cloakingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Landing" ADD COLUMN "cloakingCountries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Landing" ADD COLUMN "cloakingRedirectUrl" TEXT;
