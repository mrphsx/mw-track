-- Команда/роли (запрос пользователя 2026-07-04, Фаза 1): BUYER заменяет ADVERTISER,
-- OPERATOR — новая роль. В проде нет пользователей с ролью ADVERTISER на момент миграции
-- (единственный существующий User — SUPER_ADMIN), переименование безопасно.
ALTER TYPE "UserRole" RENAME VALUE 'ADVERTISER' TO 'BUYER';
ALTER TYPE "UserRole" ADD VALUE 'OPERATOR';
