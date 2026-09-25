-- Новые тарифы PRO/ULTIMATE (запрос пользователя 2026-09-25: "поменять условия подписки") —
-- между SCALE и ENTERPRISE. Значения лимитов/цены — в apps/api/src/modules/billing/plans.ts
-- (тарифы не хранятся в БД, только сам enum значений плана).
ALTER TYPE "SubscriptionPlan" ADD VALUE 'PRO';
ALTER TYPE "SubscriptionPlan" ADD VALUE 'ULTIMATE';
