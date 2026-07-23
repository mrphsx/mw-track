import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';

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

export interface OverlapDetailRow {
  tgUserId: string;
  tgFirstName: string | null;
  tgLastName: string | null;
  tgUsername: string | null;
  inA: { hasPurchase: boolean; totalSpent: string; isSubscribed: boolean };
  inB: { hasPurchase: boolean; totalSpent: string; isSubscribed: boolean };
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

  // Пересечение только по tgUserId (Telegram) — осознанно, запрос пользователя 2026-07-04
  // ограничен формулировкой "если это телеграм". WhatsApp/Instagram own-identity поля
  // (waPhone/igUserId) не участвуют, можно расширить позже по фидбэку.
  async getOverlapMatrix(companyId: string, userId: string, role: UserRole): Promise<OverlapMatrix> {
    const accessible = await this.getAccessibleProjectIds(companyId, userId, role);
    if (accessible.length === 0) return { projects: [], totals: {}, pairs: [] };

    const projects = await this.prisma.project.findMany({
      where: { id: { in: accessible } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const totalsRaw = await this.prisma.client.groupBy({
      by: ['projectId'],
      where: { companyId, deletedAt: null, tgUserId: { not: null }, projectId: { in: accessible } },
      _count: { _all: true },
    });
    const totals = Object.fromEntries(totalsRaw.map((t) => [t.projectId, t._count._all]));

    // $queryRaw не проходит через tenant-scoping middleware (ловит только
    // findFirst/findMany/count/aggregate/create/update/delete) — companyId и accessible
    // project id фильтруются в самом SQL, тот же принцип, что в clients.repository.ts.
    // Prisma.join — правильный способ подставить динамический список id в IN(...): просто
    // ${accessible.join(',')} параметризовался бы как ОДНА строка, а не список значений.
    const idList = Prisma.join(accessible);
    const pairsRaw = await this.prisma.$queryRaw<{ projectAId: string; projectBId: string; count: bigint }[]>`
      SELECT c1."projectId" AS "projectAId", c2."projectId" AS "projectBId",
             COUNT(DISTINCT c1."tgUserId") AS count
      FROM "Client" c1
      JOIN "Client" c2 ON c1."tgUserId" = c2."tgUserId" AND c1."projectId" < c2."projectId"
      WHERE c1."companyId" = ${companyId} AND c2."companyId" = ${companyId}
        AND c1."deletedAt" IS NULL AND c2."deletedAt" IS NULL
        AND c1."tgUserId" IS NOT NULL
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

  async getOverlapDetail(companyId: string, userId: string, role: UserRole, projectAId: string, projectBId: string): Promise<OverlapDetailRow[]> {
    const projectsService = this.getProjectsService();
    await projectsService.assertAccess(projectAId, companyId, userId, role);
    await projectsService.assertAccess(projectBId, companyId, userId, role);

    const shared = await this.prisma.$queryRaw<{ tgUserId: string }[]>`
      SELECT DISTINCT c1."tgUserId"
      FROM "Client" c1
      JOIN "Client" c2 ON c1."tgUserId" = c2."tgUserId"
      WHERE c1."projectId" = ${projectAId} AND c2."projectId" = ${projectBId}
        AND c1."companyId" = ${companyId} AND c2."companyId" = ${companyId}
        AND c1."deletedAt" IS NULL AND c2."deletedAt" IS NULL
        AND c1."tgUserId" IS NOT NULL
    `;
    const tgUserIds = shared.map((r) => r.tgUserId);
    if (tgUserIds.length === 0) return [];

    const [clientsA, clientsB] = await Promise.all([
      this.prisma.client.findMany({ where: { projectId: projectAId, tgUserId: { in: tgUserIds } } }),
      this.prisma.client.findMany({ where: { projectId: projectBId, tgUserId: { in: tgUserIds } } }),
    ]);
    const byIdB = new Map(clientsB.map((c) => [c.tgUserId!, c]));

    return clientsA
      .filter((a) => byIdB.has(a.tgUserId!))
      .map((a) => {
        const b = byIdB.get(a.tgUserId!)!;
        return {
          tgUserId: a.tgUserId!,
          tgFirstName: a.tgFirstName,
          tgLastName: a.tgLastName,
          tgUsername: a.tgUsername,
          inA: { hasPurchase: a.hasPurchase, totalSpent: a.totalSpent.toString(), isSubscribed: a.isSubscribed },
          inB: { hasPurchase: b.hasPurchase, totalSpent: b.totalSpent.toString(), isSubscribed: b.isSubscribed },
        };
      });
  }
}
