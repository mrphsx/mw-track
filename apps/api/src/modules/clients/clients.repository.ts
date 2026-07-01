import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Статистика для дашборда проекта.
  // groupBy и $queryRaw НЕ перехватываются Prisma $use middleware (оно ловит только
  // findFirst/findMany/count/aggregate/create/update/delete) — поэтому deletedAt: null
  // указан здесь явно, а не в надежде на автоскоуп.
  async getProjectStats(projectId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [
      totalClients,
      activeClients,
      newClients,
      clientsWithPurchase,
      totalRevenue,
      avgRevenue,
      channelBreakdown,
      countryBreakdown,
      dailySubscribers,
    ] = await Promise.all([
      this.prisma.client.count({ where: { projectId, deletedAt: null } }),
      this.prisma.client.count({ where: { projectId, deletedAt: null, isBotActive: true } }),
      this.prisma.client.count({ where: { projectId, deletedAt: null, createdAt: { gte: since } } }),
      this.prisma.client.count({ where: { projectId, deletedAt: null, hasPurchase: true } }),
      this.prisma.purchase.aggregate({ where: { projectId }, _sum: { amount: true } }),
      this.prisma.purchase.aggregate({ where: { projectId, createdAt: { gte: since } }, _avg: { amount: true } }),
      this.prisma.client.groupBy({
        by: ['channelType'],
        where: { projectId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ country: string; count: bigint }[]>`
        SELECT country, COUNT(*) as count
        FROM "Client"
        WHERE "projectId" = ${projectId}
          AND "deletedAt" IS NULL
          AND country IS NOT NULL
        GROUP BY country
        ORDER BY count DESC
        LIMIT 10
      `,
      this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
        SELECT DATE("createdAt") as date, COUNT(*) as count
        FROM "Client"
        WHERE "projectId" = ${projectId}
          AND "createdAt" >= ${since}
          AND "deletedAt" IS NULL
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `,
    ]);

    return {
      totalClients,
      activeClients,
      newClients,
      clientsWithPurchase,
      conversionRate: totalClients > 0 ? Math.round((clientsWithPurchase / totalClients) * 100 * 10) / 10 : 0,
      totalRevenue: Number(totalRevenue._sum.amount || 0),
      avgOrderValue: Number(avgRevenue._avg.amount || 0),
      channelBreakdown: channelBreakdown.map((c) => ({ channel: c.channelType, count: c._count._all })),
      countryBreakdown: countryBreakdown.map((c) => ({ country: c.country, count: Number(c.count) })),
      dailySubscribers: dailySubscribers.map((d) => ({ date: d.date, count: Number(d.count) })),
    };
  }

  // Воронка конверсий PageView -> Lead -> Subscribe -> Purchase.
  // TrackingEvent ещё не пишется на этапах PageView/Lead (Tracking-модуль — шаг 1.7),
  // поэтому пока реально заполняется только Subscribe (из TelegramProvider.handleJoinRequest);
  // эндпоинт уже рабочий и не требует переделки, когда 1.7 добавит остальные события.
  async getConversionFunnel(projectId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [pageViews, leads, subscribes, purchases] = await Promise.all([
      this.prisma.trackingEvent.count({ where: { projectId, eventName: 'PageView', createdAt: { gte: since } } }),
      this.prisma.trackingEvent.count({ where: { projectId, eventName: 'Lead', createdAt: { gte: since } } }),
      this.prisma.trackingEvent.count({ where: { projectId, eventName: 'Subscribe', createdAt: { gte: since } } }),
      this.prisma.trackingEvent.count({ where: { projectId, eventName: 'Purchase', createdAt: { gte: since } } }),
    ]);

    return [
      { stage: 'PageView', count: pageViews, label: 'Просмотры лендинга' },
      { stage: 'Lead', count: leads, label: 'Клик на кнопку', rate: pageViews ? Math.round((leads / pageViews) * 100) : 0 },
      {
        stage: 'Subscribe',
        count: subscribes,
        label: 'Вступили в канал',
        rate: leads ? Math.round((subscribes / leads) * 100) : 0,
      },
      {
        stage: 'Purchase',
        count: purchases,
        label: 'Совершили покупку',
        rate: subscribes ? Math.round((purchases / subscribes) * 100) : 0,
      },
    ];
  }

  // Поиск клиентов для Lookalike Export
  async getClientsForLookalikeExport(projectId: string, onlyBuyers = true) {
    return this.prisma.client.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(onlyBuyers ? { hasPurchase: true } : {}),
        OR: [{ email: { not: null } }, { tgUserId: { not: null } }, { waPhone: { not: null } }],
      },
      select: {
        email: true,
        phone: true,
        waPhone: true,
        country: true,
        // НЕ включаем Telegram ID — Facebook его не знает, для Custom Audience бесполезен
      },
    });
  }
}
