import { SubscriptionPlan } from '@prisma/client';

export interface PlanConfig {
  priceUsdt: number;
  durationDays: number;
  maxProjects: number;
  maxClients: number;
  maxPushesPerMonth: number;
}

// Цены не зафиксированы ни в одном из доков — разумные дефолты для MVP,
// меняются здесь же, без миграции (тарифы не хранятся в БД).
export const PLANS: Record<SubscriptionPlan, PlanConfig> = {
  TRIAL: { priceUsdt: 0, durationDays: 14, maxProjects: 1, maxClients: 1000, maxPushesPerMonth: 5 },
  STARTER: { priceUsdt: 49, durationDays: 30, maxProjects: 3, maxClients: 5000, maxPushesPerMonth: 10 },
  GROWTH: { priceUsdt: 149, durationDays: 30, maxProjects: 10, maxClients: 25000, maxPushesPerMonth: 50 },
  SCALE: { priceUsdt: 399, durationDays: 30, maxProjects: 30, maxClients: 100000, maxPushesPerMonth: 999 },
  ENTERPRISE: { priceUsdt: 0, durationDays: 30, maxProjects: 999, maxClients: 999999, maxPushesPerMonth: 999 },
};

// Тарифы, которые реально можно купить через автоматический инвойс —
// TRIAL выдаётся бесплатно при регистрации, ENTERPRISE — только по индивидуальным условиям.
export const PURCHASABLE_PLANS = ['STARTER', 'GROWTH', 'SCALE'] as const;
export type PurchasablePlan = (typeof PURCHASABLE_PLANS)[number];
