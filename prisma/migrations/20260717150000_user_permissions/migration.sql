-- Гранулярные права команды (запрос пользователя 2026-07-17: "кто что может делать, удалять,
-- создавать, менять лэндинги, пиксели, домены, пуши итд, что видят в статистике"). Второе
-- измерение поверх ProjectAccess: не "к каким проектам доступ", а "что внутри доступного
-- проекта разрешено". Чисто аддитивная миграция — новый enum, новая таблица, новая nullable
-- колонка на TeamInvite. Бэкфилл для существующих BUYER/OPERATOR делается отдельным
-- Nest DI-скриптом после деплоя (см. 15_PHASES.md/память) — их 0 пока не запустится, иначе
-- существующий тестовый Buyer лишится доступа немедленно после миграции.

CREATE TYPE "Permission" AS ENUM (
    'LANDINGS_VIEW', 'LANDINGS_CREATE', 'LANDINGS_EDIT', 'LANDINGS_DELETE',
    'PIXELS_VIEW', 'PIXELS_CREATE', 'PIXELS_EDIT', 'PIXELS_DELETE',
    'DOMAINS_VIEW', 'DOMAINS_CREATE', 'DOMAINS_EDIT', 'DOMAINS_DELETE',
    'PUSHES_VIEW', 'PUSHES_CREATE', 'PUSHES_SEND', 'PUSHES_DELETE',
    'AUTOMATIONS_VIEW', 'AUTOMATIONS_CREATE', 'AUTOMATIONS_EDIT', 'AUTOMATIONS_DELETE',
    'AB_TESTS_VIEW', 'AB_TESTS_CREATE', 'AB_TESTS_EDIT', 'AB_TESTS_DELETE',
    'CHANNEL_VIEW', 'CHANNEL_MANAGE',
    'CLIENTS_VIEW', 'CLIENTS_EDIT', 'CLIENTS_DELETE', 'CLIENTS_EXPORT',
    'STATS_VIEW', 'STATS_VIEW_REVENUE', 'STATS_VIEW_TEAM_LEADERBOARDS'
);

ALTER TABLE "TeamInvite" ADD COLUMN "permissions" JSONB;

CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserPermission_userId_permission_key" ON "UserPermission"("userId", "permission");
CREATE INDEX "UserPermission_userId_idx" ON "UserPermission"("userId");

ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
