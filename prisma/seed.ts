import { PrismaClient, UserRole, SubscriptionPlan } from '@prisma/client';
// require avoids ts-node misdetecting this file as ESM and breaking bcryptjs's CJS export shape
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Тарифные планы — хранятся как константы, не в БД. Дублирует apps/api/src/modules/billing/
// plans.ts (та же формула — ставка рассылок в день на каждый доступный проект тарифа, значения
// синхронизированы вручную, запрос пользователя 2026-07-30: перевод лимита рассылок с
// помесячного на дневной) — сид намеренно не импортирует его напрямую (свой ts-node-запуск,
// не тянуть резолюцию модулей apps/api ради одной константы).
export const PLAN_LIMITS: Record<
  SubscriptionPlan,
  { maxProjects: number; maxClients: number; maxPushesPerDay: number }
> = {
  TRIAL: { maxProjects: 1, maxClients: 1000, maxPushesPerDay: 2 },
  STARTER: { maxProjects: 5, maxClients: 5000, maxPushesPerDay: 10 },
  GROWTH: { maxProjects: 10, maxClients: 25000, maxPushesPerDay: 50 },
  SCALE: { maxProjects: 20, maxClients: 100000, maxPushesPerDay: 240 },
  ENTERPRISE: { maxProjects: 50, maxClients: 999999, maxPushesPerDay: 999 },
};

async function main() {
  // Super admin компания и пользователь
  const company = await prisma.company.upsert({
    where: { slug: 'super-admin' },
    update: {},
    create: {
      name: 'TrafficCRM Admin',
      slug: 'super-admin',
      plan: SubscriptionPlan.ENTERPRISE,
      ...PLAN_LIMITS.ENTERPRISE,
    },
  });

  const passwordHash = await bcrypt.hash('admin12345', 10);

  await prisma.user.upsert({
    where: { email: 'admin@trafficcrm.io' },
    update: {},
    create: {
      companyId: company.id,
      email: 'admin@trafficcrm.io',
      passwordHash,
      firstName: 'Super',
      lastName: 'Admin',
      role: UserRole.SUPER_ADMIN,
    },
  });

  console.log('Seed complete:', { companyId: company.id });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
