-- Разрешения сотрудников становятся per-project (запрос пользователя 2026-07-28: "чтобы под
-- каждый проект можно было выбрать разрешения, а не общие"). UserPermission.projectId
-- добавляется как обязательное поле — миграция делает это в безопасном порядке
-- (nullable -> backfill -> not null), а не одним шагом, потому что в таблице уже есть строки.

-- AlterEnum: новое разрешение под настройки самого проекта (найдено как дыра при аудите —
-- PATCH /projects/:id раньше не проверялся вообще никаким разрешением).
ALTER TYPE "Permission" ADD VALUE 'PROJECTS_EDIT';

-- AlterTable: добавляем колонку nullable, чтобы не потерять уже существующие строки.
ALTER TABLE "UserPermission" ADD COLUMN "projectId" TEXT;

-- Старый UNIQUE INDEX (userId, permission) — не table constraint, а именно индекс (проверено
-- напрямую в БД перед написанием миграции) — должен уйти ДО backfill-вставки ниже: иначе
-- вставка per-project копии с тем же (userId, permission), что и у ещё не удалённой старой
-- (projectId IS NULL) строки, нарушает именно этот индекс, потому что он не знает про
-- projectId вообще. Новый составной индекс создаём заранее тоже (после NOT NULL ниже он
-- корректно покроет уже вставленные + оставшиеся строки).
DROP INDEX "UserPermission_userId_permission_key";
DROP INDEX "UserPermission_userId_idx";

-- Data migration: разворачиваем каждую существующую плоскую строку {userId, permission}
-- на все ТЕКУЩИЕ проекты этого пользователя (ProjectAccess) — сохраняет ровно то же
-- эффективное поведение, что было до миграции (у кого право действовало везде, у того теперь
-- оно явно на каждом проекте, к которому есть доступ сейчас). Дальше владелец/админ может
-- развести права по проектам через Team UI.
INSERT INTO "UserPermission" (id, "userId", "projectId", "permission", "createdAt")
SELECT gen_random_uuid()::text, up."userId", pa."projectId", up."permission", up."createdAt"
FROM "UserPermission" up
JOIN "ProjectAccess" pa ON pa."userId" = up."userId"
WHERE up."projectId" IS NULL;

-- Удаляем старые плоские строки (projectId IS NULL — все они допрежние, backfill выше уже
-- создал per-project копии). Пользователь без единого ProjectAccess на момент миграции просто
-- теряет свои старые права без замены — те права и так были недостижимы без проекта, на
-- котором их применить.
DELETE FROM "UserPermission" WHERE "projectId" IS NULL;

-- AlterTable: теперь можно сделать обязательным.
ALTER TABLE "UserPermission" ALTER COLUMN "projectId" SET NOT NULL;

-- Новая уникальность/индекс — уже с учётом projectId.
CREATE UNIQUE INDEX "UserPermission_userId_projectId_permission_key" ON "UserPermission"("userId", "projectId", "permission");
CREATE INDEX "UserPermission_userId_projectId_idx" ON "UserPermission"("userId", "projectId");

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
