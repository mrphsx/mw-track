import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Client, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { StatsPeriodDto } from '../../common/dto/stats-period.dto';
import { resolveStatsPeriod } from '../../common/timezone.util';

interface OverlapPair {
  projectAId: string;
  projectBId: string;
  count: number;
}

export interface OverlapMatrix {
  projects: { id: string; name: string }[];
  totals: Record<string, number>;
  pairs: OverlapPair[];
}

// Запрос пользователя 2026-07-30: "чтобы можно было сразу сравнить действие и параметры лида в
// обеих проектах" — раньше здесь была узкая пара {hasPurchase, totalSpent, isSubscribed} на
// каждую сторону, теперь полные строки Client (то же самое, что ClientsService.findMany уже
// отдаёт для обычного списка клиентов — фронтенд рендерит их тем же ClientsTable, только двумя
// колонками рядом).
export interface OverlapDetailRow {
  tgUserId: string;
  clientA: Client;
  clientB: Client;
}

export interface OverlapDetailPage {
  items: OverlapDetailRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Сводка по конкретной паре проектов (запрос пользователя 2026-08-31, отдельная страница
// пересечения — "сколько уникальных и дубликатов"): "дубликаты" — пересечение (реально один и
// тот же человек, посчитанный в обоих проектах), "уникальные" — оставшаяся часть каждой стороны,
// которая нигде больше не встречается. Проценты считаются от каждой стороны отдельно (та же
// асимметрия, что и в матрице — см. getOverlapMatrix).
export interface OverlapPairSummary {
  projectA: { id: string; name: string; total: number };
  projectB: { id: string; name: string; total: number };
  intersection: number;
  uniqueA: number;
  uniqueB: number;
  percentA: number;
  percentB: number;
}

const ELEVATED_ROLES: UserRole[] = [UserRole.OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN];

@Injectable()
export class AudienceService {
  constructor(
    private prisma: PrismaService,
    private moduleRef: ModuleRef,
  ) {}

  // ModuleRef, не constructor injection — AudienceModule статически импортируя ProjectsModule
  // становится (в зависимости от алфавитного порядка import в app.module.ts) первой точкой
  // входа в уже существующий тесный цикл ProjectsModule -(forwardRef)-> ChannelsModule ->
  // ClientsModule -> ProjectsModule, что уронило бут ("ClientsModule imports[0] is undefined") —
  // тот же класс проблемы, что и в ChannelsController/PurchasesService, см. память.
  private getProjectsService(): ProjectsService {
    return this.moduleRef.get(ProjectsService, { strict: false });
  }

  // Тот же elevatedRoles-паттерн, что и в ProjectsService.findAll/LandingsService.findAllForCompany
  // — Buyer/Operator видят пересечения только между СВОИМИ проектами (через ProjectAccess).
  private async getAccessibleProjectIds(companyId: string, userId: string, role: UserRole): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(ELEVATED_ROLES.includes(role) ? {} : { projectAccess: { some: { userId } } }),
      },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  // Период фильтрует по Client.subscribedAt (запрос пользователя 2026-08-31: "добавь период как
  // на странице проекта") — резолвится в UTC, не в зоне какого-то одного проекта: пересечение по
  // определению охватывает НЕСКОЛЬКО проектов сразу, каждый со своим часовым поясом, тот же
  // приём и та же осознанная приблизительность, что уже применяется в ProjectsService.
  // getCompanyStats (тоже company-wide, тоже без единой "своей" зоны). period.period не задан
  // вообще (не просто пустая строка) — значит фильтра нет совсем, вся история разом (обратная
  // совместимость + так же ведёт себя API до этой фичи).
  private async resolvePeriodWindow(period?: StatsPeriodDto): Promise<{ since: Date; until: Date } | null> {
    if (!period?.period) return null;
    return resolveStatsPeriod(this.prisma, 'UTC', period);
  }

  // Пересечение только по tgUserId (Telegram) — осознанно, запрос пользователя 2026-07-04
  // ограничен формулировкой "если это телеграм". WhatsApp/Instagram own-identity поля
  // (waPhone/igUserId) не участвуют, можно расширить позже по фидбэку.
  async getOverlapMatrix(companyId: string, userId: string, role: UserRole, period?: StatsPeriodDto): Promise<OverlapMatrix> {
    const accessibleAll = await this.getAccessibleProjectIds(companyId, userId, role);
    if (accessibleAll.length === 0) return { projects: [], totals: {}, pairs: [] };

    // WEBSITE-проекты исключены (запрос пользователя 2026-09-03: "в пересечениях аудитории я
    // тоже не знаю как ты отследишь клиентов, там особо данных клиента нет с таких проектов") —
    // пересечение считается строго по tgUserId (см. комментарий выше), а у WEBSITE-клиентов его
    // никогда не бывает (только visitorId) — такой проект физически не может пересечься ни с
    // одним другим, показывать его строкой/столбцом с гарантированным нулём было бы просто шумом.
    const websiteProjectIds = new Set(
      (
        await this.prisma.project.findMany({
          where: { id: { in: accessibleAll }, channel: { type: 'WEBSITE' } },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    const accessible = accessibleAll.filter((id) => !websiteProjectIds.has(id));
    if (accessible.length === 0) return { projects: [], totals: {}, pairs: [] };

    const projects = await this.prisma.project.findMany({
      where: { id: { in: accessible } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const window = await this.resolvePeriodWindow(period);

    // subscribedAt: {not: null} — "наш" клиент, реально прошедший через воронку (OURS_ONLY,
    // тот же признак, что и в clients.repository.ts), а не просто написавший боту/личному
    // аккаунту мимо CRM-воронки (запрос пользователя 2026-08-31: "всегда показывай только
    // наших" — раньше этого фильтра здесь не было вообще, пересечение считало вообще всех
    // Client с непустым tgUserId, включая внешних). window заменяет not:null на конкретный
    // диапазон дат — диапазон сам по себе уже исключает null.
    const totalsRaw = await this.prisma.client.groupBy({
      by: ['projectId'],
      where: {
        companyId,
        deletedAt: null,
        tgUserId: { not: null },
        subscribedAt: window ? { gte: window.since, lt: window.until } : { not: null },
        projectId: { in: accessible },
      },
      _count: { _all: true },
    });
    const totals = Object.fromEntries(totalsRaw.map((t) => [t.projectId, t._count._all]));

    // $queryRaw не проходит через tenant-scoping middleware (ловит только
    // findFirst/findMany/count/aggregate/create/update/delete) — companyId и accessible
    // project id фильтруются в самом SQL, тот же принцип, что в clients.repository.ts.
    // Prisma.join — правильный способ подставить динамический список id в IN(...): просто
    // ${accessible.join(',')} параметризовался бы как ОДНА строка, а не список значений.
    const idList = Prisma.join(accessible);
    const periodSql = window
      ? Prisma.sql`AND c1."subscribedAt" >= ${window.since} AND c1."subscribedAt" < ${window.until} AND c2."subscribedAt" >= ${window.since} AND c2."subscribedAt" < ${window.until}`
      : Prisma.sql`AND c1."subscribedAt" IS NOT NULL AND c2."subscribedAt" IS NOT NULL`;
    const pairsRaw = await this.prisma.$queryRaw<{ projectAId: string; projectBId: string; count: bigint }[]>`
      SELECT c1."projectId" AS "projectAId", c2."projectId" AS "projectBId",
             COUNT(DISTINCT c1."tgUserId") AS count
      FROM "Client" c1
      JOIN "Client" c2 ON c1."tgUserId" = c2."tgUserId" AND c1."projectId" < c2."projectId"
      WHERE c1."companyId" = ${companyId} AND c2."companyId" = ${companyId}
        AND c1."deletedAt" IS NULL AND c2."deletedAt" IS NULL
        AND c1."tgUserId" IS NOT NULL
        ${periodSql}
        AND c1."projectId" IN (${idList})
        AND c2."projectId" IN (${idList})
      GROUP BY c1."projectId", c2."projectId"
    `;

    return {
      projects,
      totals,
      pairs: pairsRaw.map((p) => ({ projectAId: p.projectAId, projectBId: p.projectBId, count: Number(p.count) })),
    };
  }

  // Пагинация — запрос пользователя 2026-07-30 ("с пагинацией") — сортировка по tgUserId для
  // стабильного порядка страниц (простой детерминированный ключ, не завязан ни на одну из двух
  // сторон персонально). LIMIT/OFFSET применяются к самому списку общих tgUserId ДО дозагрузки
  // полных строк Client — иначе при большом пересечении пришлось бы каждый раз тянуть всех
  // клиентов с обеих сторон только чтобы показать одну страницу.
  //
  // search (запрос пользователя 2026-07-30: "когда открываешь список клиентов тоже нужен
  // поиск, по имени, user_id, username итд") — матчится по ЛЮБОЙ стороне пары (c1 ИЛИ c2): один
  // и тот же человек может иметь разное отображаемое имя в двух проектах (сменил имя между
  // подписками), но ищем-то одного и того же реального пользователя, так что должно хватать
  // совпадения хоть с одной стороны. ILIKE-параметр подставляется через Prisma.sql —
  // параметризовано (не конкатенация сырой строки), безопасно от SQL-инъекций.
  async getOverlapDetail(
    companyId: string,
    userId: string,
    role: UserRole,
    projectAId: string,
    projectBId: string,
    page: number,
    limit: number,
    search?: string,
    period?: StatsPeriodDto,
  ): Promise<OverlapDetailPage> {
    const projectsService = this.getProjectsService();
    await projectsService.assertAccess(projectAId, companyId, userId, role);
    await projectsService.assertAccess(projectBId, companyId, userId, role);

    const window = await this.resolvePeriodWindow(period);
    const periodSql = window
      ? Prisma.sql`AND c1."subscribedAt" >= ${window.since} AND c1."subscribedAt" < ${window.until} AND c2."subscribedAt" >= ${window.since} AND c2."subscribedAt" < ${window.until}`
      : Prisma.sql`AND c1."subscribedAt" IS NOT NULL AND c2."subscribedAt" IS NOT NULL`;

    const sharedWhere = Prisma.sql`
      c1."projectId" = ${projectAId} AND c2."projectId" = ${projectBId}
      AND c1."companyId" = ${companyId} AND c2."companyId" = ${companyId}
      AND c1."deletedAt" IS NULL AND c2."deletedAt" IS NULL
      AND c1."tgUserId" IS NOT NULL
      ${periodSql}
      ${
        search
          ? Prisma.sql`AND (
              c1."tgUserId" ILIKE ${`%${search}%`} OR c1."tgFirstName" ILIKE ${`%${search}%`} OR c1."tgLastName" ILIKE ${`%${search}%`} OR c1."tgUsername" ILIKE ${`%${search}%`}
              OR c2."tgFirstName" ILIKE ${`%${search}%`} OR c2."tgLastName" ILIKE ${`%${search}%`} OR c2."tgUsername" ILIKE ${`%${search}%`}
            )`
          : Prisma.empty
      }
    `;

    const [{ count }] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT c1."tgUserId")::bigint as count
      FROM "Client" c1
      JOIN "Client" c2 ON c1."tgUserId" = c2."tgUserId"
      WHERE ${sharedWhere}
    `;
    const total = Number(count);
    const totalPages = Math.ceil(total / limit);
    if (total === 0) return { items: [], total: 0, page, limit, totalPages: 0 };

    const shared = await this.prisma.$queryRaw<{ tgUserId: string }[]>`
      SELECT DISTINCT c1."tgUserId"
      FROM "Client" c1
      JOIN "Client" c2 ON c1."tgUserId" = c2."tgUserId"
      WHERE ${sharedWhere}
      ORDER BY c1."tgUserId"
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `;
    const tgUserIds = shared.map((r) => r.tgUserId);

    const [clientsA, clientsB] = await Promise.all([
      this.prisma.client.findMany({ where: { projectId: projectAId, tgUserId: { in: tgUserIds } } }),
      this.prisma.client.findMany({ where: { projectId: projectBId, tgUserId: { in: tgUserIds } } }),
    ]);
    const byIdA = new Map(clientsA.map((c) => [c.tgUserId!, c]));
    const byIdB = new Map(clientsB.map((c) => [c.tgUserId!, c]));

    // Порядок сохраняем по tgUserIds (уже отсортирован в SQL) — так строки A и B на фронтенде
    // остаются попарно выровнены построчно между двумя колонками.
    const items = tgUserIds
      .filter((id) => byIdA.has(id) && byIdB.has(id))
      .map((id) => ({ tgUserId: id, clientA: byIdA.get(id)!, clientB: byIdB.get(id)! }));

    return { items, total, page, limit, totalPages };
  }

  // Сводка для отдельной страницы пары проектов (запрос пользователя 2026-08-31: "сколько
  // уникальных и дубликатов") — 3 счётчика (totalA/totalB/intersection), уникальные считаются
  // вычитанием (uniqueA = totalA - intersection), не отдельным запросом — пересечение уже
  // однозначно определяет, сколько из totalA пересекается, остаток и есть уникальные для A.
  async getOverlapPairSummary(
    companyId: string,
    userId: string,
    role: UserRole,
    projectAId: string,
    projectBId: string,
    period?: StatsPeriodDto,
  ): Promise<OverlapPairSummary> {
    const projectsService = this.getProjectsService();
    await projectsService.assertAccess(projectAId, companyId, userId, role);
    await projectsService.assertAccess(projectBId, companyId, userId, role);

    const [projectA, projectB] = await Promise.all([
      this.prisma.project.findUniqueOrThrow({ where: { id: projectAId }, select: { id: true, name: true } }),
      this.prisma.project.findUniqueOrThrow({ where: { id: projectBId }, select: { id: true, name: true } }),
    ]);

    const window = await this.resolvePeriodWindow(period);
    const subscribedFilter = window ? { gte: window.since, lt: window.until } : { not: null };
    const periodSql = window
      ? Prisma.sql`AND c1."subscribedAt" >= ${window.since} AND c1."subscribedAt" < ${window.until} AND c2."subscribedAt" >= ${window.since} AND c2."subscribedAt" < ${window.until}`
      : Prisma.sql`AND c1."subscribedAt" IS NOT NULL AND c2."subscribedAt" IS NOT NULL`;

    const [totalA, totalB, intersectionRows] = await Promise.all([
      this.prisma.client.count({
        where: { projectId: projectAId, companyId, deletedAt: null, tgUserId: { not: null }, subscribedAt: subscribedFilter },
      }),
      this.prisma.client.count({
        where: { projectId: projectBId, companyId, deletedAt: null, tgUserId: { not: null }, subscribedAt: subscribedFilter },
      }),
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT c1."tgUserId")::bigint as count
        FROM "Client" c1
        JOIN "Client" c2 ON c1."tgUserId" = c2."tgUserId"
        WHERE c1."projectId" = ${projectAId} AND c2."projectId" = ${projectBId}
          AND c1."companyId" = ${companyId} AND c2."companyId" = ${companyId}
          AND c1."deletedAt" IS NULL AND c2."deletedAt" IS NULL
          AND c1."tgUserId" IS NOT NULL
          ${periodSql}
      `,
    ]);
    const intersection = Number(intersectionRows[0].count);

    return {
      projectA: { ...projectA, total: totalA },
      projectB: { ...projectB, total: totalB },
      intersection,
      uniqueA: totalA - intersection,
      uniqueB: totalB - intersection,
      percentA: totalA > 0 ? Math.round((intersection / totalA) * 100) : 0,
      percentB: totalB > 0 ? Math.round((intersection / totalB) * 100) : 0,
    };
  }
}
