import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { dailyBucketSql, resolveStatsPeriod } from '../../common/timezone.util';
import { StatsPeriodDto } from '../../common/dto/stats-period.dto';

export interface CrossProjectOverlapMatch {
  projectId: string;
  projectName: string;
  joinedAt: Date | null;
  hasDialogue: boolean;
  dialogueAt: Date | null;
}

@Injectable()
export class ClientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // "Ещё в проектах" (запрос пользователя 2026-07-30, список клиентов проекта) — тот же принцип
  // tgUserId-матчинга, что AudienceService уже использует для пересечения аудиторий (Telegram
  // only, осознанно — WhatsApp/Instagram own-identity поля не участвуют). Батч на всю страницу
  // клиентов разом (не по одному запросу на клиента) — иначе список из 50 строк дал бы 50
  // лишних запросов.
  async getCrossProjectOverlap(companyId: string, projectId: string, tgUserIds: string[]): Promise<Map<string, CrossProjectOverlapMatch[]>> {
    const result = new Map<string, CrossProjectOverlapMatch[]>();
    if (tgUserIds.length === 0) return result;

    const rows = await this.prisma.client.findMany({
      where: { companyId, projectId: { not: projectId }, deletedAt: null, tgUserId: { in: tgUserIds } },
      select: { tgUserId: true, projectId: true, subscribedAt: true, firstDialogueAt: true },
    });
    if (rows.length === 0) return result;

    const otherProjectIds = [...new Set(rows.map((r) => r.projectId))];
    const projects = await this.prisma.project.findMany({ where: { id: { in: otherProjectIds } }, select: { id: true, name: true } });
    const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

    for (const row of rows) {
      const list = result.get(row.tgUserId!) ?? [];
      list.push({
        projectId: row.projectId,
        projectName: projectNameById.get(row.projectId) ?? '—',
        joinedAt: row.subscribedAt,
        hasDialogue: row.firstDialogueAt !== null,
        dialogueAt: row.firstDialogueAt,
      });
      result.set(row.tgUserId!, list);
    }
    return result;
  }

  // Статистика для дашборда проекта.
  // groupBy и $queryRaw НЕ перехватываются Prisma $use middleware (оно ловит только
  // findFirst/findMany/count/aggregate/create/update/delete) — поэтому deletedAt: null
  // указан здесь явно, а не в надежде на автоскоуп.
  // buyerId (запрос пользователя 2026-08-03, "только своя стата") — опционально, скоупит КАЖДУЮ
  // метрику ниже на клиентов/события/покупки, атрибутированные именно этому баеру. Client и
  // TrackingEvent несут buyerId своей колонкой напрямую; Purchase — нет (только clientId), для
  // неё скоуп идёт подзапросом по Client (см. purchaseBuyerFilterSql), не через JOIN — не нужно
  // менять алиасы в уже существующих запросах.
  async getProjectStats(projectId: string, periodQuery: StatsPeriodDto, buyerId?: string) {
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
    const buyerWhere = buyerId ? { buyerId } : {};
    const buyerFilterSql = buyerId ? Prisma.sql`AND "buyerId" = ${buyerId}` : Prisma.empty;
    // Запрос пользователя 2026-08-05: "выручка не должна показывать покупки внешних клиентов" —
    // раньше этот подзапрос скоупил Purchase по баеру ТОЛЬКО когда buyerId явно задан, а
    // "наш ли клиент" (subscribedAt IS NOT NULL, тот же критерий OURS_ONLY, что уже применяется
    // ко всем метрикам клиентов чуть выше) вообще не проверялся — Purchase считается напрямую по
    // projectId, без единого упоминания Client.subscribedAt. Внешние контакты (холодные, писавшие
    // мимо воронки — см. комментарий у OURS_ONLY) с ручной покупкой (registeredBy) утекали в
    // totalRevenue/avgOrderValue/dailyRevenue/FD-РД наравне с настоящими подписчиками. Теперь
    // "наш клиент" — обязательное условие всегда, buyerId — опциональное дополнение поверх него.
    // deletedAt IS NULL добавлен тем же днём отдельным баг-репортом (проект Isabella Ramirez,
    // "выручка 99, а в топ баеров сумма 94") — покупка мягко удалённого (объединённого как
    // дубликат, см. feedback_archived_project_webhook_hijack) клиента продолжала считаться в
    // totalRevenue, хотя getLeaderboards уже фильтрует такие клиенты через deletedAt IS NULL на
    // своём JOIN — то же несоответствие "разные числа в разных местах", что и с subscribedAt.
    const purchaseBuyerFilterSql = Prisma.sql`AND "clientId" IN (
      SELECT id FROM "Client" WHERE "subscribedAt" IS NOT NULL AND "deletedAt" IS NULL${buyerId ? Prisma.sql` AND "buyerId" = ${buyerId}` : Prisma.empty}
    )`;

    const [
      totalClients,
      activeClients,
      botActivatedClients,
      newClients,
      unsubscribedClients,
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
      avgSubscribeToDialogueRow,
    ] = await Promise.all([
      // totalClients/activeClients намеренно БЕЗ окна дат (баг-репорт пользователя 2026-07-24
      // поднял вопрос — оставлены как есть по явному решению пользователя) — карточка
      // "Клиентов" на странице проекта использует period-scoped newClients ниже, а не эти два;
      // totalClients/activeClients держат синхронность с карточкой проекта в общем списке
      // /projects (ProjectsService.getClientMetricsByProject — тот же фильтр OURS_ONLY, тоже
      // всегда за всё время, там вообще нет PeriodSelector), см. баг-репорт 2026-07-17
      // "в карточке проекта пишет другие цифры клиентов, не как внутри страницы проекта".
      this.prisma.client.count({ where: { projectId, deletedAt: null, ...OURS_ONLY, ...buyerWhere } }),
      this.prisma.client.count({ where: { projectId, deletedAt: null, isBotActive: true, ...OURS_ONLY, ...buyerWhere } }),
      // "Активировавшие бота" — буквально те, кто реально написал/нажал Start боту в этом
      // периоде (botActivatedAt задан внутри окна), НЕ "кому можно отправить пуш прямо сейчас".
      // Раньше (2026-07-17/18, см. feedback_client_bot_activated_status) формула была
      // isBotActive:true И (subscribedAt ИЛИ botActivatedAt в периоде) — по явной просьбе
      // пользователя тогда, чтобы карточка совпадала с push-аудиторией. Баг-репорт пользователя
      // 2026-07-30 ("вижу 2 активировали бота, но в клиентах эти же 2 новых подписчика не
      // отмечены активированными") вскрыл, что это вводило в заблуждение: subscribedAt-ветка
      // засчитывала любого свежего подписчика, даже если он ни разу не писал боту (isBotActive
      // по умолчанию true у каждого нового Client — см. schema.prisma), т.е. карточка и колонка
      // "Статус бота" в таблице клиентов отвечали на РАЗНЫЕ вопросы под одинаковой подписью.
      // Проверено на реальных данных проекта cms3h8xkv004nje3l7neyyfv7: оба "активировавших"
      // сегодня клиента (Cam./Angel) имели botActivatedAt: null — попали в счётчик только через
      // subscribedAt. Пользователь явно попросил вариант 3 из предложенных: оставить формулу
      // push-аудитории (buildPushFilterWhere) как есть, а эту карточку считать строго по
      // botActivatedAt — теперь это единственный критерий, isBotActive не проверяется (сам факт
      // активации в периоде не должен исчезать из статистики, если бота потом заблокировали).
      this.prisma.client.count({
        where: { projectId, deletedAt: null, botActivatedAt: { gte: since, lt: until }, ...buyerWhere },
      }),
      this.prisma.client.count({ where: { projectId, deletedAt: null, subscribedAt: { gte: since, lt: until }, ...buyerWhere } }),
      // Отписавшиеся за период (запрос пользователя 2026-07-24, в довесок к фиксу карточки
      // "Клиентов": "даже если человек отписался показывай его в числе подписчиков, но добавь
      // ещё одну метрику: отписались") — newClients выше намеренно не вычитает их, это просто
      // отдельная параллельная цифра для той же карточки.
      this.prisma.client.count({ where: { projectId, deletedAt: null, unsubscribedAt: { gte: since, lt: until }, ...buyerWhere } }),
      // clientsWithPurchase — тоже не реагировал на период (баг-репорт 2026-07-24) — заменили
      // "когда-либо был нашим" (OURS_ONLY, без дат) на "подписался именно в этом периоде" —
      // тот же критерий, что и у newClients выше (общий знаменатель для conversionRate ниже).
      this.prisma.client.count({
        where: { projectId, deletedAt: null, hasPurchase: true, subscribedAt: { gte: since, lt: until }, ...buyerWhere },
      }),
      // Баг-репорт пользователя 2026-07-25: "доход неправильно считается по периоду, стоит
      // одна и та же сумма на любой период" — раньше здесь не было окна дат вообще (только
      // projectId), тот же класс бага, что уже чинили 2026-07-24 у totalClients/
      // clientsWithPurchase выше, просто это конкретное поле тогда пропустили (комментарий,
      // ссылавшийся на "осознанное решение", был неверным — реальной ссылки на согласование
      // с пользователем не было, просто дальше по коду avgRevenue уже смотрело на период, а
      // totalRevenue рядом — нет). Теперь оба смотрят на одно и то же окно.
      this.prisma.purchase.aggregate({
        where: { projectId, createdAt: { gte: since, lt: until }, client: { subscribedAt: { not: null }, deletedAt: null, ...buyerWhere } },
        _sum: { amount: true },
      }),
      this.prisma.purchase.aggregate({
        where: { projectId, createdAt: { gte: since, lt: until }, client: { subscribedAt: { not: null }, deletedAt: null, ...buyerWhere } },
        _avg: { amount: true },
      }),
      // Просмотры/клики за окно (запрос пользователя 2026-07-17, "больше метрик на странице
      // проекта") — те же события, что уже считает getConversionFunnel, но здесь как
      // самостоятельные карточки/график, а не только строки в списке воронки. buyerId — теперь
      // реальная колонка на TrackingEvent (запрос пользователя 2026-08-03, см. TrackingService.
      // resolveAttribution), просмотры/клики тоже атрибутируются баеру.
      this.prisma.trackingEvent.count({ where: { projectId, eventName: 'PageView', createdAt: { gte: since, lt: until }, ...buyerWhere } }),
      this.prisma.trackingEvent.count({ where: { projectId, eventName: 'Lead', createdAt: { gte: since, lt: until }, ...buyerWhere } }),
      this.prisma.client.groupBy({
        by: ['channelType'],
        where: { projectId, deletedAt: null, ...OURS_ONLY, ...buyerWhere },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ country: string; count: bigint }[]>`
        SELECT country, COUNT(*) as count
        FROM "Client"
        WHERE "projectId" = ${projectId}
          AND "deletedAt" IS NULL
          AND "subscribedAt" IS NOT NULL
          AND country IS NOT NULL
          ${buyerFilterSql}
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
          ${buyerFilterSql}
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
          ${buyerFilterSql}
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
          ${buyerFilterSql}
        GROUP BY date
        ORDER BY date ASC
      `,
      // Шаг 2.7 "график выручки по дням" (запрос пользователя 2026-07-15) — та же
      // tz-aware bucket-идиома, что и у dailySubscribers/dailyDialogues выше. Purchase не
      // софт-удаляется (нет deletedAt на модели — финансовая запись, не тенантная сущность
      // в этом смысле), поэтому доп. фильтра здесь не требуется. purchaseBuyerFilterSql —
      // Purchase не несёт свою колонку buyerId, скоуп идёт подзапросом по Client.clientId.
      this.prisma.$queryRaw<{ date: Date; total: string | null }[]>`
        SELECT ${createdBucket} as date, SUM(amount) as total
        FROM "Purchase"
        WHERE "projectId" = ${projectId}
          AND "createdAt" >= ${since}
          AND "createdAt" < ${until}
          ${purchaseBuyerFilterSql}
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
          ${buyerFilterSql}
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
          ${buyerFilterSql}
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
            ${purchaseBuyerFilterSql}
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
      // Среднее время от подписки до первого диалога (запрос пользователя 2026-07-30: "нужна
      // еще одна статистика, среднее время которое проходит от подписки до диалога за разные
      // периоды") — тот же фильтр, что и у dailyCrmDialogues выше (subscribedAt задан И не
      // позже firstDialogueAt, чтобы не считать "холодные" диалоги от людей, подписавшихся уже
      // ПОСЛЕ того, как написали боту, — такое бывает у PERSONAL_DM/менеджерских сценариев), окно
      // — по дате самого диалога (firstDialogueAt в периоде), реагирует на PeriodSelector как и
      // остальные карточки. AVG(EXTRACT(EPOCH FROM ...)) — секунды, дробные, агрегируются в JS.
      this.prisma.$queryRaw<{ avg_seconds: number | null }[]>`
        SELECT AVG(EXTRACT(EPOCH FROM ("firstDialogueAt" - "subscribedAt")))::float as avg_seconds
        FROM "Client"
        WHERE "projectId" = ${projectId}
          AND "deletedAt" IS NULL
          AND "firstDialogueAt" >= ${since}
          AND "firstDialogueAt" < ${until}
          AND "subscribedAt" IS NOT NULL
          AND "subscribedAt" <= "firstDialogueAt"
          ${buyerFilterSql}
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
      unsubscribedClients,
      clientsWithPurchase,
      // Знаменатель — newClients (подписались в периоде), не totalClients (за всё время) —
      // баг-репорт пользователя 2026-07-24, конверсия тоже не реагировала на период раньше.
      conversionRate: newClients > 0 ? Math.round((clientsWithPurchase / newClients) * 100 * 10) / 10 : 0,
      totalRevenue: Number(totalRevenue._sum.amount || 0),
      avgOrderValue: Number(avgRevenue._avg.amount || 0),
      totalPageViews,
      totalLeads,
      totalFd,
      totalRd,
      totalDialogues,
      totalCrmDialogues,
      // null, если в периоде нет ни одного CRM-диалога с известной датой подписки — честное
      // "нет данных", а не 0 (0 секунд читалось бы как "мгновенно", что неверно).
      avgSubscribeToDialogueSeconds: avgSubscribeToDialogueRow[0]?.avg_seconds ?? null,
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
  // buyerId (запрос пользователя 2026-08-03, "только своя стата") — см. комментарий у
  // getProjectStats выше, тот же приём.
  async getConversionFunnel(projectId: string, periodQuery: StatsPeriodDto, buyerId?: string) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
    const { since, until } = await resolveStatsPeriod(this.prisma, project.timezone, periodQuery);
    const buyerWhere = buyerId ? { buyerId } : {};
    const buyerFilterSql = buyerId ? Prisma.sql`AND "buyerId" = ${buyerId}` : Prisma.empty;
    // Тот же фикс, что в getProjectStats выше (запрос пользователя 2026-08-05) — ФД/РД в воронке
    // считались по Purchase без проверки, что покупатель вообще "наш" (subscribedAt задан) и не
    // мягко удалён (deletedAt IS NULL — второй баг-репорт того же дня, проект Isabella Ramirez).
    const purchaseBuyerFilterSql = Prisma.sql`AND "clientId" IN (
      SELECT id FROM "Client" WHERE "subscribedAt" IS NOT NULL AND "deletedAt" IS NULL${buyerId ? Prisma.sql` AND "buyerId" = ${buyerId}` : Prisma.empty}
    )`;

    const [pageViews, leads, subscribes, dialogueRows, deposits] = await Promise.all([
      this.prisma.trackingEvent.count({ where: { projectId, eventName: 'PageView', createdAt: { gte: since, lt: until }, ...buyerWhere } }),
      this.prisma.trackingEvent.count({ where: { projectId, eventName: 'Lead', createdAt: { gte: since, lt: until }, ...buyerWhere } }),
      this.prisma.client.count({ where: { projectId, deletedAt: null, subscribedAt: { gte: since, lt: until }, ...buyerWhere } }),
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
          ${buyerFilterSql}
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
            ${purchaseBuyerFilterSql}
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

  // "Моя статистика" (Operator, запрос пользователя 2026-07-30) — сколько клиентов вообще на
  // проекте (тот же "ours only" фильтр, что getProjectStats) и сколько депозитов ЛИЧНО
  // зарегистрировал этот сотрудник (Purchase.registeredBy, заполняется при ручном "Добавить
  // покупку" — см. PurchasesService.create), не "клиенты назначенные ему" — такой привязки в
  // модели нет и не создаётся (подтверждено пользователем явно).
  async getMyStats(projectId: string, userId: string, periodQuery: StatsPeriodDto) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
    const { since, until } = await resolveStatsPeriod(this.prisma, project.timezone, periodQuery);

    const [totalClients, myPurchases] = await Promise.all([
      this.prisma.client.count({ where: { projectId, deletedAt: null, subscribedAt: { not: null } } }),
      this.prisma.purchase.aggregate({
        where: { projectId, registeredBy: userId, createdAt: { gte: since, lt: until } },
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    return {
      totalClients,
      myPurchasesCount: myPurchases._count,
      myPurchasesRevenue: Number(myPurchases._sum.amount ?? 0),
    };
  }

  // Поиск клиентов для Lookalike Export. scopedBuyerId (запрос пользователя 2026-08-03) —
  // "только свои клиенты" для Buyer.
  async getClientsForLookalikeExport(projectId: string, onlyBuyers = true, scopedBuyerId?: string) {
    return this.prisma.client.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(onlyBuyers ? { hasPurchase: true } : {}),
        ...(scopedBuyerId ? { buyerId: scopedBuyerId } : {}),
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
