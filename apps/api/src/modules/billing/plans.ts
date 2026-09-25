import { SubscriptionPlan } from '@prisma/client';

export interface PlanConfig {
  priceUsdt: number;
  durationDays: number;
  maxProjects: number;
  maxClients: number;
  maxPushesPerDay: number;
}

// Цены не зафиксированы ни в одном из доков — разумные дефолты для MVP,
// меняются здесь же, без миграции (тарифы не хранятся в БД, кроме самого enum значений плана —
// см. prisma/schema.prisma SubscriptionPlan).
//
// maxPushesPerDay — переведено с помесячного лимита на дневной 2026-07-30 (запрос пользователя:
// "поменять саму подписку, пусть будет по проектам, клиентам, рассылок В ДЕНЬ"). Формула,
// согласованная с пользователем явно (2 вопроса через AskUserQuestion): ставка рассылок в день
// на КАЖДЫЙ доступный проект тарифа × maxProjects этого тарифа = итоговый дневной лимит.
// ENTERPRISE — исключение из формулы (тоже подтверждено явно): плоские 999, не масштабируется
// по числу проектов, т.к. это премиум/индивидуальный тариф, а не расчётный шаг лестницы.
// TRIAL: 1 × 2/день = 2 (историческое значение, см. правку ниже); STARTER: 5 × 2 = 10;
// GROWTH: 10 × 5 = 50; ENTERPRISE: 999 (плоский sentinel). SCALE и новые PRO/ULTIMATE ниже
// больше НЕ следуют этой формуле — их дневные лимиты заданы явно пользователем 2026-09-25, не
// выведены расчётом.
//
// Обновлено 2026-09-25 (запрос пользователя "поменять условия подписки на тарифы"):
// - SCALE: было {price:399, maxProjects:20, maxClients:100000, maxPushesPerDay:240} →
//   стало {price:299, maxProjects:25, maxClients:50000, maxPushesPerDay:100} — дешевле и с
//   заметно меньшим лимитом клиентов/рассылок, но чуть большим числом проектов.
// - PRO — новый тариф между SCALE и ULTIMATE, $599, 50 проектов, 120000 клиентов, 250 рассылок/день.
// - ULTIMATE — новый топовый самообслуживаемый тариф (ENTERPRISE по-прежнему отдельно, только по
//   индивидуальным условиям), $1199, 200 проектов, 500000 клиентов, 1 000 000 рассылок/день.
// Названия PRO/ULTIMATE выбраны как продолжение существующей лестницы STARTER→GROWTH→SCALE —
// не были явно заданы пользователем, легко переименовать при необходимости (потребует ещё одной
// ALTER TYPE ... RENAME VALUE миграции, см. прецедент в 20260704140000_team_roles).
//
// TRIAL ужесточён тем же днём (запрос пользователя, отдельный от смены платных тарифов выше):
// maxClients 1000→100, maxPushesPerDay 2→1 (maxProjects остался 1). Плюс — не в этом файле,
// а в LandingsService.assertCloakingConditionsAllowed/CloakingConditionRow.tsx — на TRIAL из
// клоакинга доступно только условие "Страна", остальные открываются со Starter.
export const PLANS: Record<SubscriptionPlan, PlanConfig> = {
  TRIAL: { priceUsdt: 0, durationDays: 14, maxProjects: 1, maxClients: 100, maxPushesPerDay: 1 },
  STARTER: { priceUsdt: 49, durationDays: 30, maxProjects: 5, maxClients: 5000, maxPushesPerDay: 10 },
  GROWTH: { priceUsdt: 149, durationDays: 30, maxProjects: 10, maxClients: 25000, maxPushesPerDay: 50 },
  SCALE: { priceUsdt: 299, durationDays: 30, maxProjects: 25, maxClients: 50000, maxPushesPerDay: 100 },
  PRO: { priceUsdt: 599, durationDays: 30, maxProjects: 50, maxClients: 120000, maxPushesPerDay: 250 },
  ULTIMATE: { priceUsdt: 1199, durationDays: 30, maxProjects: 200, maxClients: 500000, maxPushesPerDay: 1000000 },
  ENTERPRISE: { priceUsdt: 0, durationDays: 30, maxProjects: 50, maxClients: 999999, maxPushesPerDay: 999 },
};

// Тарифы, которые реально можно купить через автоматический инвойс —
// TRIAL выдаётся бесплатно при регистрации, ENTERPRISE — только по индивидуальным условиям.
export const PURCHASABLE_PLANS = ['STARTER', 'GROWTH', 'SCALE', 'PRO', 'ULTIMATE'] as const;
export type PurchasablePlan = (typeof PURCHASABLE_PLANS)[number];
