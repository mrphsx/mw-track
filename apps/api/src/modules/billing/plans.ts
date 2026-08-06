import { SubscriptionPlan } from '@prisma/client';

export interface PlanConfig {
  priceUsdt: number;
  durationDays: number;
  maxProjects: number;
  maxClients: number;
  maxPushesPerDay: number;
}

// Цены не зафиксированы ни в одном из доков — разумные дефолты для MVP,
// меняются здесь же, без миграции (тарифы не хранятся в БД).
//
// maxPushesPerDay — переведено с помесячного лимита на дневной 2026-07-30 (запрос пользователя:
// "поменять саму подписку, пусть будет по проектам, клиентам, рассылок В ДЕНЬ"). Формула,
// согласованная с пользователем явно (2 вопроса через AskUserQuestion): ставка рассылок в день
// на КАЖДЫЙ доступный проект тарифа × maxProjects этого тарифа = итоговый дневной лимит.
// ENTERPRISE — исключение из формулы (тоже подтверждено явно): плоские 999, не масштабируется
// по числу проектов, т.к. это премиум/индивидуальный тариф, а не расчётный шаг лестницы.
//
// maxProjects — обновлено 2026-07-30 (запрос пользователя "поменяй планы"): TRIAL 1 (без
// изменений) → STARTER 5 (была 3) → GROWTH 10 (без изменений) → SCALE 20 (была 30) →
// ENTERPRISE 50 (было 999 — раньше был sentinel "фактически безлимит", теперь реальный кап,
// подтверждено явно). Цена и maxClients не менялись — только количество проектов и,
// как следствие, дневной лимит рассылок у STARTER/SCALE (у TRIAL/GROWTH число проектов не
// изменилось, поэтому и лимит рассылок остался прежним).
// TRIAL: 1 × 2/день = 2; STARTER: 5 × 2 = 10; GROWTH: 10 × 5 = 50; SCALE: 20 × 12 = 240;
// ENTERPRISE: 999 (плоский sentinel, не 50 × ставка).
export const PLANS: Record<SubscriptionPlan, PlanConfig> = {
  TRIAL: { priceUsdt: 0, durationDays: 14, maxProjects: 1, maxClients: 1000, maxPushesPerDay: 2 },
  STARTER: { priceUsdt: 49, durationDays: 30, maxProjects: 5, maxClients: 5000, maxPushesPerDay: 10 },
  GROWTH: { priceUsdt: 149, durationDays: 30, maxProjects: 10, maxClients: 25000, maxPushesPerDay: 50 },
  SCALE: { priceUsdt: 399, durationDays: 30, maxProjects: 20, maxClients: 100000, maxPushesPerDay: 240 },
  ENTERPRISE: { priceUsdt: 0, durationDays: 30, maxProjects: 50, maxClients: 999999, maxPushesPerDay: 999 },
};

// Тарифы, которые реально можно купить через автоматический инвойс —
// TRIAL выдаётся бесплатно при регистрации, ENTERPRISE — только по индивидуальным условиям.
export const PURCHASABLE_PLANS = ['STARTER', 'GROWTH', 'SCALE'] as const;
export type PurchasablePlan = (typeof PURCHASABLE_PLANS)[number];
