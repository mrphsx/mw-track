import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { dailyBucketSql, resolveStatsPeriod } from '../../common/timezone.util';
import { StatsPeriodDto } from '../../common/dto/stats-period.dto';

@Injectable()
export class ClientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Статистика для дашборда проекта.
  // groupBy и $queryRaw НЕ перехватываются Prisma $use middleware (оно ловит только
  // findFirst/findMany/count/aggregate/create/update/delete) — поэтому deletedAt: null
  // указан здесь явно, а не в надежде на автоскоуп.
  async getProjectStats(projectId: string, periodQuery: StatsPeriodDto) {
    // Часовой пояс проекта (запрос пользователя 2026-07-04) — "сутки" на дневных графиках
    // считаются по нему, не по UTC, см. common/timezone.util.ts.
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
    const { since, until } = await resolveStatsPeriod(this.prisma, project.timezone, periodQuery);
    const createdBucket = dailyBucketSql('createdAt', project.timezone);
    const dialogueBucket = dailyBucketSql('firstDialogueAt', project.timezone);
    const subscribedBucket = dailyBucketSql('subscribedAt', project.timezone);
    // "Наш клиент" = реально пришёл через воронку (subscribedAt задан), не просто написал в
    // личку/боту мимо трекинга (баг-репорт пользователя 2026-07-17 — см. ClientsService.
    // recordInboundMessage/findOrCreate: такие холодные контакты теперь создаются с
    // subscribedAt: null именно чтобы их можно было исключить здесь).
    const OURS_ONLY = { subscribedAt: { not: null } } as const;

    const [
      totalClients,
      activeClients,
      botActivatedClients,
      newClients,
      clientsWithPurchase,
      totalRevenue,
      avgRevenue,
      totalPageViews,
      totalLeads,
      channelBreakdown,
      countryBreakdown,
      dailySubscribers,
      dailyDialogues,
      dailyCrmDialogues,
      dailyRevenue,
      dailyPageViews,
      dailyLeads,
      dailyDeposits,
    ] = await Promise.all([
      this.prisma.client.count({ where: { projectId, deletedAt: null, ...OURS_ONLY } }),
      this.prisma.client.count({ where: { projectId, deletedAt: null, isBotActive: true, ...OURS_ONLY } }),
      // "Активировавшие бота" (запрос пользователя 2026-07-17/18) — те, кому уже МОЖНО
      // отправить пуш прямо сейчас: та же формула, что ClientsService.buildPushFilterWhere
      // использует для реальной аудитории рассылок (isBotActive: true И (subscribedAt задан
      // ИЛИ botActivatedAt задан)). Пользователь явно поправил: "активировавшие бота должны
      // быть те, кому можно уже кидать рассылки" — просто botActivatedAt один давал 0, даже
      // когда push-аудитория показывала 1 (mrphsx попадает через subscribedAt, у него
      // botActivatedAt пока пуст — исторические диалоги не бэкфилятся, см.
      // feedback_client_bot_activated_status).
      this.prisma.client.count({
        where: {
          projectId,
          deletedAt: null,
          isBotActive: true,
          OR: [{ subscribedAt: { not: null } }, { botActivatedAt: { not: null } }],
        },
      }),
      this.prisma.client.count({ where: { projectId, deletedAt: null, subscribedAt: { gte: since, lt: until } } }),
      this.prisma.client.count({ where: { projectId, deletedAt: null, hasPurchase: true, ...OURS_ONLY } }),
      this.prisma.purchase.aggregate({ where: { projectId }, _sum: { amount: true } }),
      this.prisma.purchase.aggregate({ where: { projectId, createdAt: { gte: since, lt: until } }, _avg: { amount: true } }),
      // Просмотры/клики за окно (запрос пользователя 2026-07-17, "больше метрик на странице
      // проекта") — те же события, что уже считает getConversionFunnel, но здесь как
      // самостоятельные карточки/график, а не только строки в списке воронки.
      this.prisma.trackingEvent.count({ where: { projectId, eventName: 'PageView', createdAt: { gte: since, lt: until } } }),
      this.prisma.trackingEvent.count({ where: { projectId, eventName: 'Lead', createdAt: { gte: since, lt: until } } }),
      this.prisma.client.groupBy({
        by: ['channelType'],
        where: { projectId, deletedAt: null, ...OURS_ONLY },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ country: string; count: bigint }[]>`
        SELECT country, COUNT(*) as count
        FROM "Client"
        WHERE "projectId" = ${projectId}
          AND "deletedAt" IS NULL
          AND "subscribedAt" IS NOT NULL
          AND country IS NOT NULL
        GROUP BY country
        ORDER BY count DESC
        LIMIT 10
      `,
      // Дневная разбивка — теперь по subscribedAt, а не по createdAt (баг-репорт пользователя
      // 2026-07-17: карточка/график "подписчики" считали КАЖДЫЙ новый Client, включая
      // холодные контакты, которые просто написали в личку мимо нашей ссылки/лендинга —
      // такой Client создаётся с subscribedAt: null, поэтому window-фильтр на subscribedAt
      // естественно их исключает без отдельного NOT NULL условия).
      this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
        SELECT ${subscribedBucket} as date, COUNT(*) as count
        FROM "Client"
        WHERE "projectId" = ${projectId}
          AND "subscribedAt" >= ${since}
          AND "subscribedAt" < ${until}
          AND "deletedAt" IS NULL
        GROUP BY date
        ORDER BY date ASC
      `,
      this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
        SELECT ${dialogueBucket} as date, COUNT(*) as count
        FROM "Client"
        WHERE "projectId" = ${projectId}
          AND "firstDialogueAt" >= ${since}
          AND "firstDialogueAt" < ${until}
          AND "deletedAt" IS NULL
          AND "firstDialogueAt" IS NOT NULL
        GROUP BY date
        ORDER BY date ASC
      `,
      // "Диалоги из нашей CRM" (запрос пользователя 2026-07-17) — те же первые диалоги, что и
      // выше, но только от людей, которые на момент сообщения уже были подписаны на канал
      // через нашу воронку (subscribedAt задан и не позже firstDialogueAt) — отсекает
      // "холодные" диалоги от случайных людей, которые просто написали в личку, минуя лендинг/
      // канал. subscribedAt не сбрасывается при отписке (ClientsService.unsubscribe трогает
      // только isSubscribed/unsubscribedAt), поэтому это надёжный исторический маркер, а не
      // сегодняшний статус подписки.
      this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
        SELECT ${dialogueBucket} as date, COUNT(*) as count
        FROM "Client"
        WHERE "projectId" = ${projectId}
          AND "firstDialogueAt" >= ${since}
          AND "firstDialogueAt" < ${until}
          AND "deletedAt" IS NULL
          AND "firstDialogueAt" IS NOT NULL
          AND "subscribedAt" IS NOT NULL
          AND "subscribedAt" <= "firstDialogueAt"
        GROUP BY date
        ORDER BY date ASC
      `,
      // Шаг 2.7 "график выручки по дням" (запрос пользователя 2026-07-15) — та же
      // tz-aware bucket-идиома, что и у dailySubscribers/dailyDialogues выше. Purchase не
      // софт-удаляется (нет deletedAt на модели — финансовая запись, не тенантная сущность
      // в этом смысле), поэтому доп. фильтра здесь не требуется.
      this.prisma.$queryRaw<{ date: Date; total: string | null }[]>`
        SELECT ${createdBucket} as date, SUM(amount) as total
        FROM "Purchase"
        WHERE "projectId" = ${projectId}
          AND "createdAt" >= ${since}
          AND "createdAt" < ${until}
        GROUP BY date
        ORDER BY date ASC
      `,
      this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
        SELECT ${createdBucket} as date, COUNT(*) as count
        FROM "TrackingEvent"
        WHERE "projectId" = ${projectId}
          AND "eventName" = 'PageView'
          AND "createdAt" >= ${since}
          AND "createdAt" < ${until}
        GROUP BY date
        ORDER BY date ASC
      `,
      this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
        SELECT ${createdBucket} as date, COUNT(*) as count
        FROM "TrackingEvent"
        WHERE "projectId" = ${projectId}
          AND "eventName" = 'Lead'
          AND "createdAt" >= ${since}
          AND "createdAt" < ${until}
        GROUP BY date
        ORDER BY date ASC
      `,
      // ФД/РД (первый/повторный депозит, запрос пользователя 2026-07-17) — то же деление, что
      // уже использует PurchasesService.create() для триггера бот-сценария
      // (isFirstDeposit = clientBefore.purchasesCount === 0, см. purchases.service.ts), но
      // выражено декларативно через ROW_NUMBER() по всей истории покупок клиента (не только за
      // окно) — покупка, которая на самом деле повторная, но чей "первый депозит" случился ДО
      // начала 30-дневного окна, всё равно должна попасть в РД, а не в ФД. rn считается над
      // ВСЕЙ таблицей Purchase проекта (без фильтра по since) именно поэтому, фильтр по since
      // применяется уже снаружи CTE.
      this.prisma.$queryRaw<{ date: Date; fd_count: bigint; rd_count: bigint; fd_revenue: string | null; rd_revenue: string | null }[]>`
        WITH ranked AS (
          SELECT id, "createdAt", amount,
            ROW_NUMBER() OVER (PARTITION BY "clientId" ORDER BY "createdAt" ASC, id ASC) as rn
          FROM "Purchase"
          WHERE "projectId" = ${projectId}
        )
        SELECT
          ${createdBucket} as date,
          COUNT(*) FILTER (WHERE rn = 1) as fd_count,
          COUNT(*) FILTER (WHERE rn > 1) as rd_count,
          COALESCE(SUM(amount) FILTER (WHERE rn = 1), 0) as fd_revenue,
          COALESCE(SUM(amount) FILTER (WHERE rn > 1), 0) as rd_revenue
        FROM ranked
        WHERE "createdAt" >= ${since}
          AND "createdAt" < ${until}
        GROUP BY date
        ORDER BY date ASC
      `,
    ]);

    // totalFd/totalRd/totalDialogues/totalCrmDialogues — суммы по тому же выбранному периоду,
    // что и остальные "карточечные" метрики (newClients и т.п.), а не всё время жизни проекта
    // (как totalRevenue) — считаются суммированием уже полученного daily-массива, отдельный
    // запрос не нужен.
    const totalFd = dailyDeposits.reduce((sum, d) => sum + Number(d.fd_count), 0);
    const totalRd = dailyDeposits.reduce((sum, d) => sum + Number(d.rd_count), 0);
    // Диалоги — важная метрика (запрос пользователя 2026-07-17), выносим итог за период в
    // карточку, а не только в график.
    const totalDialogues = dailyDialogues.reduce((sum, d) => sum + Number(d.count), 0);
    const totalCrmDialogues = dailyCrmDialogues.reduce((sum, d) => sum + Number(d.count), 0);

    return {
      totalClients,
      activeClients,
      botActivatedClients,
      newClients,
      clientsWithPurchase,
      conversionRate: totalClients > 0 ? Math.round((clientsWithPurchase / totalClients) * 100 * 10) / 10 : 0,
      totalRevenue: Number(totalRevenue._sum.amount || 0),
      avgOrderValue: Number(avgRevenue._avg.amount || 0),
      totalPageViews,
      totalLeads,
      totalFd,
      totalRd,
      totalDialogues,
      totalCrmDialogues,
      channelBreakdown: channelBreakdown.map((c) => ({ channel: c.channelType, count: c._count._all })),
      countryBreakdown: countryBreakdown.map((c) => ({ country: c.country, count: Number(c.count) })),
      dailySubscribers: dailySubscribers.map((d) => ({ date: d.date, count: Number(d.count) })),
      dailyPageViews: dailyPageViews.map((d) => ({ date: d.date, count: Number(d.count) })),
      dailyLeads: dailyLeads.map((d) => ({ date: d.date, count: Number(d.count) })),
      dailyDeposits: dailyDeposits.map((d) => ({
        date: d.date,
        fdCount: Number(d.fd_count),
        rdCount: Number(d.rd_count),
        fdRevenue: Number(d.fd_revenue || 0),
        rdRevenue: Number(d.rd_revenue || 0),
      })),
      // crmCount — подмножество count (см. запрос выше), поэтому каждая дата dailyCrmDialogues
      // гарантированно уже есть среди дат dailyDialogues, отдельный merge по недостающим датам
      // не нужен.
      dailyDialogues: (() => {
        const crmByDate = new Map(dailyCrmDialogues.map((d) => [d.date.toISOString().slice(0, 10), Number(d.count)]));
        return dailyDialogues.map((d) => ({
          date: d.date,
          count: Number(d.count),
          crmCount: crmByDate.get(d.date.toISOString().slice(0, 10)) ?? 0,
        }));
      })(),
      dailyRevenue: dailyRevenue.map((d) => ({ date: d.date, amount: Number(d.total || 0) })),
    };
  }

  // Воронка конверсий PageView -> Lead -> Subscribe -> Purchase.
  // TrackingEvent ещё не пишется на этапах PageView/Lead (Tracking-модуль — шаг 1.7),
  // поэтому пока реально заполняется только Subscribe (из TelegramProvider.handleJoinRequest);
  // эндпоинт уже рабочий и не требует переделки, когда 1.7 добавит остальные события.
  //
  // Багфикс 2026-07-04 (реальный баг-репорт пользователя: на странице лендинга подписчиков
  // "именно по нашему лендингу" — 1 (Client.landingId, см. LandingsService.getStats), а тут
  // "Вступили в канал" — 78): этап Subscribe считался прямым count() по TrackingEvent —
  // TrackingEvent никогда не софт-удаляется и не дедуплицируется (до фикса
  // handleChatMemberUpdate, см. 15_PHASES.md/"chat_member bypass bug", один и тот же вход в
  // канал мог писать Subscribe-событие дважды — из handleJoinRequest И из
  // handleChatMemberUpdate, у второго нет уникального idempotencyKey). Даже после того, как
  // 60 "загрязнённых" Client были удалены (soft-delete), их старые TrackingEvent остались в
  // таблице навсегда и продолжали учитываться. Переведено на COUNT по Client.subscribedAt —
  // тот же Client, что и остальная статистика проекта (deletedAt: null), не может задвоиться
  // (findOrCreate — один Client на tgUserId) и корректно перестаёт учитывать
  // soft-удалённых/загрязнённых клиентов.
  async getConversionFunnel(projectId: string, periodQuery: StatsPeriodDto) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
    const { since, until } = await resolveStatsPeriod(this.prisma, project.timezone, periodQuery);

    const [pageViews, leads, subscribes, dialogueRows, deposits] = await Promise.all([
      this.prisma.trackingEvent.count({ where: { projectId, eventName: 'PageView', createdAt: { gte: since, lt: until } } }),
      this.prisma.trackingEvent.count({ where: { projectId, eventName: 'Lead', createdAt: { gte: since, lt: until } } }),
      this.prisma.client.count({ where: { projectId, deletedAt: null, subscribedAt: { gte: since, lt: until } } }),
      // Диалог в воронке должен идти строго ПОСЛЕ Subscribe — значит считаем только
      // "CRM-диалоги" (см. dailyCrmDialogues выше): человек уже был подписан на канал через
      // нашу воронку на момент первого сообщения. Обычный Prisma count по firstDialogueAt
      // считал ЛЮБОЙ диалог, включая холодные контакты, которые просто написали мимо нашей
      // ссылки/лендинга (баг-репорт пользователя 2026-07-17) — из-за этого доля "Диалог от
      // Подписка" могла даже превышать 100%. Раньше это маскировалось тем, что такие холодные
      // Client создавались с subscribedAt = "сейчас" (баг), из-за чего формально проходили и
      // под "CRM" тоже; после фикса findOrCreate/recordInboundMessage у них subscribedAt
      // теперь честно null, и это условие их корректно исключает.
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count
        FROM "Client"
        WHERE "projectId" = ${projectId}
          AND "deletedAt" IS NULL
          AND "firstDialogueAt" >= ${since}
          AND "firstDialogueAt" < ${until}
          AND "subscribedAt" IS NOT NULL
          AND "subscribedAt" <= "firstDialogueAt"
      `,
      // ФД/РД (запрос пользователя 2026-07-17) вместо единой стадии "Purchase" — тот же
      // ROW_NUMBER()-подход, что и в getProjectStats.dailyDeposits (см. комментарий там), но
      // единой суммой за окно, а не по дням. Считается напрямую по таблице Purchase, а не по
      // TrackingEvent 'Purchase' (как раньше) — тот же класс бага, что уже чинили для Subscribe
      // выше: TrackingEvent не дедуплицируется и не отражает soft-delete клиента.
      this.prisma.$queryRaw<{ fd_count: bigint; rd_count: bigint }[]>`
        WITH ranked AS (
          SELECT id, "createdAt",
            ROW_NUMBER() OVER (PARTITION BY "clientId" ORDER BY "createdAt" ASC, id ASC) as rn
          FROM "Purchase"
          WHERE "projectId" = ${projectId}
        )
        SELECT
          COUNT(*) FILTER (WHERE rn = 1) as fd_count,
          COUNT(*) FILTER (WHERE rn > 1) as rd_count
        FROM ranked
        WHERE "createdAt" >= ${since}
          AND "createdAt" < ${until}
      `,
    ]);

    const dialogues = Number(dialogueRows[0]?.count ?? 0);
    const fd = Number(deposits[0]?.fd_count ?? 0);
    const rd = Number(deposits[0]?.rd_count ?? 0);

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
        stage: 'Dialogue',
        count: dialogues,
        label: 'Начали диалог',
        rate: subscribes ? Math.round((dialogues / subscribes) * 100) : 0,
      },
      {
        stage: 'FirstDeposit',
        count: fd,
        label: 'Первый депозит (ФД)',
        rate: dialogues ? Math.round((fd / dialogues) * 100) : 0,
      },
      {
        stage: 'RepeatDeposit',
        count: rd,
        label: 'Повторный депозит (РД)',
        rate: fd ? Math.round((rd / fd) * 100) : 0,
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
