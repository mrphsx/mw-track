import { PrismaClient, UserRole, SubscriptionPlan } from '@prisma/client';
// require avoids ts-node misdetecting this file as ESM and breaking bcryptjs's CJS export shape
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Тарифные планы — хранятся как константы, не в БД
export const PLAN_LIMITS: Record<
  SubscriptionPlan,
  { maxProjects: number; maxClients: number; maxPushesPerMonth: number }
> = {
  TRIAL: { maxProjects: 1, maxClients: 1000, maxPushesPerMonth: 5 },
  STARTER: { maxProjects: 3, maxClients: 5000, maxPushesPerMonth: 10 },
  GROWTH: { maxProjects: 10, maxClients: 25000, maxPushesPerMonth: 50 },
  SCALE: { maxProjects: 30, maxClients: 100000, maxPushesPerMonth: 999 },
  ENTERPRISE: { maxProjects: 999, maxClients: 999999, maxPushesPerMonth: 999 },
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
