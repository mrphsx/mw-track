import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateCompanySubscriptionDto } from './dto/update-company-subscription.dto';
import { PLANS } from '../billing/plans';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  // Все методы этого сервиса намеренно НЕ идут через assertAccess/компанийно-скоупленные
  // паттерны остального приложения — Super Admin панель (Фаза 4.3) кросс-тенантна по
  // определению. Company/ErrorLog/AdminActionLog не входят в modelsWithCompany
  // (PrismaService middleware), поэтому обычные prisma-вызовы здесь уже не скоупятся ни на
  // чью companyId — доп. обхода не требуется.

  async getCompanies(search: string | undefined, page: number, limit: number) {
    const take = Math.min(limit || 50, 200);
    const skip = (Math.max(page, 1) - 1) * take;

    const where = {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { slug: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          balance: true,
          planExpiresAt: true,
          currentProjects: true,
          maxProjects: true,
          currentClients: true,
          maxClients: true,
          pushesToday: true,
          maxPushesPerDay: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.company.count({ where }),
    ]);

    return { items, total, page: Math.max(page, 1), limit: take, totalPages: Math.ceil(total / take) };
  }

  async getStats() {
    const [total, byPlan, expired, usage] = await Promise.all([
      this.prisma.company.count({ where: { deletedAt: null } }),
      this.prisma.company.groupBy({ by: ['plan'], where: { deletedAt: null }, _count: true }),
      this.prisma.company.count({ where: { deletedAt: null, planExpiresAt: { lt: new Date() } } }),
      this.prisma.company.aggregate({
        where: { deletedAt: null },
        _sum: { currentProjects: true, currentClients: true },
      }),
    ]);

    return {
      totalCompanies: total,
      expiredCompanies: expired,
      byPlan: byPlan.map((g) => ({ plan: g.plan, count: g._count })),
      totalProjects: usage._sum.currentProjects ?? 0,
      totalClients: usage._sum.currentClients ?? 0,
    };
  }

  async updateSubscription(companyId: string, adminUserId: string, dto: UpdateCompanySubscriptionDto) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { plan: true, planExpiresAt: true },
    });
    if (!company) throw new NotFoundException('Компания не найдена');

    const nextExpiresAt = dto.planExpiresAt === undefined ? company.planExpiresAt : dto.planExpiresAt ? new Date(dto.planExpiresAt) : null;
    // Лимиты (maxProjects/maxClients/maxPushesPerDay) материализованы прямо на Company —
    // checkSubscriptionLimit сравнивает current* с ними напрямую, а не пересчитывает план на
    // лету. Смена plan без пересчёта лимитов из PLANS оставляет старые значения нетронутыми
    // (тот же паттерн уже соблюдается в BillingService.chargeForPlan/downgradeToTrial).
    const limits = PLANS[dto.plan];

    const [updated] = await this.prisma.$transaction([
      this.prisma.company.update({
        where: { id: companyId },
        data: {
          plan: dto.plan,
          planExpiresAt: nextExpiresAt,
          maxProjects: limits.maxProjects,
          maxClients: limits.maxClients,
          maxPushesPerDay: limits.maxPushesPerDay,
        },
      }),
      this.prisma.adminActionLog.create({
        data: {
          adminUserId,
          companyId,
          action: 'SUBSCRIPTION_CHANGE',
          previousValue: { plan: company.plan, planExpiresAt: company.planExpiresAt },
          newValue: { plan: dto.plan, planExpiresAt: nextExpiresAt },
        },
      }),
    ]);

    return updated;
  }

  async getErrors(companyId: string | undefined, page: number, limit: number) {
    const take = Math.min(limit || 50, 200);
    const skip = (Math.max(page, 1) - 1) * take;
    const where = companyId ? { companyId } : {};

    const [items, total] = await Promise.all([
      this.prisma.errorLog.findMany({
        where,
        include: { company: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.errorLog.count({ where }),
    ]);

    return { items, total, page: Math.max(page, 1), limit: take, totalPages: Math.ceil(total / take) };
  }

  async getActions(companyId: string | undefined, page: number, limit: number) {
    const take = Math.min(limit || 50, 200);
    const skip = (Math.max(page, 1) - 1) * take;
    const where = companyId ? { companyId } : {};

    const [items, total] = await Promise.all([
      this.prisma.adminActionLog.findMany({
        where,
        include: { company: { select: { name: true } }, admin: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.adminActionLog.count({ where }),
    ]);

    return { items, total, page: Math.max(page, 1), limit: take, totalPages: Math.ceil(total / take) };
  }
}
