import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChannelType, Client, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientFiltersDto } from './dto/client-filters.dto';
import { PushFilterDto } from './dto/push-filter.dto';
import { ClientsRepository } from './clients.repository';

export class ClientLimitReachedException extends Error {
  constructor() {
    super('Достигнут лимит клиентов для этого тарифного плана');
  }
}

export interface FindOrCreateClientInput {
  projectId: string;
  channelType: ChannelType;
  tgUserId?: string;
  tgUsername?: string;
  tgFirstName?: string;
  tgLastName?: string;
  tgLanguage?: string;
  waPhone?: string;
  waName?: string;
  igUserId?: string;
  igUsername?: string;
  email?: string;
  phone?: string;
  ipAddress?: string;
  userAgent?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  fbclid?: string;
  ttclid?: string;
  subscribedAt?: Date;
}

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    private prisma: PrismaService,
    private repository: ClientsRepository,
  ) {}

  async findOrCreate(data: FindOrCreateClientInput): Promise<Client> {
    const where = this.buildIdentityWhere(data.projectId, data);
    const existing = await this.prisma.client.findFirst({ where });

    if (existing) {
      return this.prisma.client.update({
        where: { id: existing.id },
        data: {
          isSubscribed: true,
          isBotActive: true,
          lastActiveAt: new Date(),
          subscribedAt: existing.subscribedAt ?? data.subscribedAt ?? new Date(),
          tgUsername: data.tgUsername ?? existing.tgUsername,
          tgFirstName: data.tgFirstName ?? existing.tgFirstName,
          tgLastName: data.tgLastName ?? existing.tgLastName,
          tgLanguage: data.tgLanguage ?? existing.tgLanguage,
          utmSource: existing.utmSource ?? data.utmSource,
          fbclid: existing.fbclid ?? data.fbclid,
          ttclid: existing.ttclid ?? data.ttclid,
        },
      });
    }

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: data.projectId },
      select: { companyId: true },
    });
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: project.companyId } });

    if (company.currentClients >= company.maxClients) {
      throw new ClientLimitReachedException();
    }

    const geo = data.ipAddress ? await this.getGeoByIp(data.ipAddress) : {};

    const client = await this.prisma.client.create({
      data: {
        companyId: project.companyId,
        projectId: data.projectId,
        channelType: data.channelType,
        tgUserId: data.tgUserId,
        tgUsername: data.tgUsername,
        tgFirstName: data.tgFirstName,
        tgLastName: data.tgLastName,
        tgLanguage: data.tgLanguage,
        waPhone: data.waPhone,
        waName: data.waName,
        igUserId: data.igUserId,
        igUsername: data.igUsername,
        email: data.email,
        phone: data.phone,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        utmSource: data.utmSource,
        utmMedium: data.utmMedium,
        utmCampaign: data.utmCampaign,
        utmContent: data.utmContent,
        utmTerm: data.utmTerm,
        fbclid: data.fbclid,
        ttclid: data.ttclid,
        country: geo.country,
        city: geo.city,
        isSubscribed: true,
        subscribedAt: data.subscribedAt ?? new Date(),
        lastActiveAt: new Date(),
      },
    });

    await this.prisma.company.update({
      where: { id: project.companyId },
      data: { currentClients: { increment: 1 } },
    });

    return client;
  }

  async updateTracking(
    tgUserId: string,
    projectId: string,
    data: { fbclid?: string; ttclid?: string; utmSource?: string; utmCampaign?: string },
  ) {
    const client = await this.prisma.client.findFirst({ where: { projectId, tgUserId } });
    if (!client) return null;

    return this.prisma.client.update({
      where: { id: client.id },
      data: {
        fbclid: data.fbclid ?? client.fbclid,
        ttclid: data.ttclid ?? client.ttclid,
        utmSource: data.utmSource ?? client.utmSource,
        utmCampaign: data.utmCampaign ?? client.utmCampaign,
      },
    });
  }

  // updateMany вместо findFirst+update — это вызывается из catch-блока отправки
  // сообщения (best-effort), не должно бросать, если клиент почему-то не нашёлся
  async markBotBlocked(tgUserId: string, projectId: string) {
    return this.prisma.client.updateMany({
      where: { projectId, tgUserId },
      data: { isBotActive: false },
    });
  }

  async markUnsubscribed(tgUserId: string, projectId: string) {
    return this.prisma.client.updateMany({
      where: { projectId, tgUserId },
      data: { isSubscribed: false, unsubscribedAt: new Date() },
    });
  }

  async findByUsername(username: string, projectId: string): Promise<Client | null> {
    return this.prisma.client.findFirst({ where: { projectId, tgUsername: username, deletedAt: null } });
  }

  async findByTgId(tgUserId: string, projectId: string): Promise<Client | null> {
    return this.prisma.client.findFirst({ where: { projectId, tgUserId, deletedAt: null } });
  }

  // companyId передаётся явно (а не доверяется только Prisma-middleware), потому что
  // этот метод дёргается и из HTTP-контроллера (контекст есть), и потенциально из
  // фоновых задач (BullMQ воркер в 1.7/1.8, контекста AsyncLocalStorage там нет)
  async findOne(id: string, companyId: string): Promise<Client> {
    const client = await this.prisma.client.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { _count: { select: { purchases: true } } },
    });
    if (!client) throw new NotFoundException('Клиент не найден');
    return client;
  }

  async findMany(projectId: string, filters: ClientFiltersDto) {
    const where = this.buildClientFilterWhere(projectId, filters);

    let orderBy: Prisma.ClientOrderByWithRelationInput = { createdAt: 'desc' };
    if (filters.sortBy === 'totalSpent') orderBy = { totalSpent: 'desc' };
    if (filters.sortBy === 'lastActive') orderBy = { lastActiveAt: 'desc' };
    if (filters.sortBy === 'purchases') orderBy = { purchasesCount: 'desc' };

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 200);

    const [items, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { purchases: true } } },
      }),
      this.prisma.client.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // Сколько клиентов реально получат пуш (подписаны + бот не заблокирован)
  async countPushAudience(projectId: string, filters: PushFilterDto): Promise<number> {
    return this.prisma.client.count({ where: this.buildPushFilterWhere(projectId, filters) });
  }

  // Сколько клиентов попадает в сегмент вообще, без требования isSubscribed/isBotActive —
  // используется PushesService для пары audienceTotal/audienceReachable на Push (шаг 1.8)
  async countAudienceTotal(projectId: string, filters: PushFilterDto): Promise<number> {
    return this.prisma.client.count({ where: this.buildPushFilterWhere(projectId, filters, { reachableOnly: false }) });
  }

  // Курсорная выдача аудитории чанками — чтобы воркер рассылки (1.8) не грузил
  // в память сразу всю базу клиентов на крупных проектах
  async *getClientsForPushInChunks(
    projectId: string,
    filters: PushFilterDto,
    chunkSize = 200,
  ): AsyncGenerator<Client[]> {
    const where = this.buildPushFilterWhere(projectId, filters);
    let cursor: string | undefined;

    while (true) {
      const chunk = await this.prisma.client.findMany({
        where,
        orderBy: { id: 'asc' },
        take: chunkSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (chunk.length === 0) return;
      yield chunk;
      cursor = chunk[chunk.length - 1].id;
      if (chunk.length < chunkSize) return;
    }
  }

  // CSV для Facebook Custom Audience (Lookalike)
  async exportForLookalike(projectId: string, onlyBuyers: boolean): Promise<string> {
    const clients = await this.repository.getClientsForLookalikeExport(projectId, onlyBuyers);

    const headers = ['email', 'phone', 'country'];
    const rows = clients.map((c) => [c.email || '', c.waPhone || c.phone || '', c.country || '']);

    return [headers.join(','), ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join('\n');
  }

  // GDPR-удаление: помимо deletedAt, реально стираем PII (иначе это не "удаление",
  // а просто скрытие строки из выдачи) — дока этот нюанс не уточняла, но soft-delete
  // без скрабинга персональных данных не соответствует смыслу GDPR-запроса на удаление
  async softDelete(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);

    await this.prisma.client.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isSubscribed: false,
        tgUsername: null,
        tgFirstName: null,
        tgLastName: null,
        tgPhotoUrl: null,
        waName: null,
        igUsername: null,
        email: null,
        phone: null,
        ipAddress: null,
        userAgent: null,
      },
    });
  }

  // clientId уже проверен контроллером через findOne(id, companyId) перед вызовом —
  // TrackingEvent/PushLog не входят в modelsWithCompany (нет колонки companyId),
  // поэтому сами по себе не были бы изолированы по тенанту без этой проверки выше.
  async findEvents(clientId: string) {
    return this.prisma.trackingEvent.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' } });
  }

  async findPushLogs(clientId: string) {
    return this.prisma.pushLog.findMany({
      where: { clientId },
      include: { push: { select: { id: true, name: true, status: true, sentAt: true } } },
    });
  }

  private buildClientFilterWhere(projectId: string, filters: ClientFiltersDto): Prisma.ClientWhereInput {
    const where: Prisma.ClientWhereInput = { projectId, deletedAt: null };

    if (filters.channelType?.length) where.channelType = { in: filters.channelType };
    if (typeof filters.hasPurchase === 'boolean') where.hasPurchase = filters.hasPurchase;
    if (typeof filters.isBotActive === 'boolean') where.isBotActive = filters.isBotActive;
    if (typeof filters.isSubscribed === 'boolean') where.isSubscribed = filters.isSubscribed;
    if (filters.country?.length) where.country = { in: filters.country };
    if (filters.utmSource) where.utmSource = filters.utmSource;
    if (filters.utmCampaign) where.utmCampaign = filters.utmCampaign;

    if (filters.minSpent !== undefined || filters.maxSpent !== undefined) {
      where.totalSpent = {
        ...(filters.minSpent !== undefined ? { gte: filters.minSpent } : {}),
        ...(filters.maxSpent !== undefined ? { lte: filters.maxSpent } : {}),
      };
    }

    if (filters.subscribedFrom || filters.subscribedTo) {
      where.subscribedAt = {
        ...(filters.subscribedFrom ? { gte: new Date(filters.subscribedFrom) } : {}),
        ...(filters.subscribedTo ? { lte: new Date(filters.subscribedTo) } : {}),
      };
    }

    if (filters.search) {
      where.OR = [
        { tgUsername: { contains: filters.search, mode: 'insensitive' } },
        { tgFirstName: { contains: filters.search, mode: 'insensitive' } },
        { tgLastName: { contains: filters.search, mode: 'insensitive' } },
        { waPhone: { contains: filters.search } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { waName: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private buildPushFilterWhere(
    projectId: string,
    filters: PushFilterDto,
    opts: { reachableOnly?: boolean } = { reachableOnly: true },
  ): Prisma.ClientWhereInput {
    const where: Prisma.ClientWhereInput = { projectId, deletedAt: null };
    if (opts.reachableOnly !== false) {
      where.isSubscribed = true;
      where.isBotActive = true;
    }

    if (filters.channelTypes?.length) where.channelType = { in: filters.channelTypes };
    if (typeof filters.hasPurchase === 'boolean') where.hasPurchase = filters.hasPurchase;
    if (filters.countries?.length) where.country = { in: filters.countries };
    if (filters.minSpent !== undefined) where.totalSpent = { gte: filters.minSpent };

    if (filters.subscribedFrom || filters.subscribedTo) {
      where.subscribedAt = {
        ...(filters.subscribedFrom ? { gte: new Date(filters.subscribedFrom) } : {}),
        ...(filters.subscribedTo ? { lte: new Date(filters.subscribedTo) } : {}),
      };
    }

    if (filters.inactiveDaysMin !== undefined) {
      where.lastActiveAt = { lte: new Date(Date.now() - filters.inactiveDaysMin * 24 * 60 * 60 * 1000) };
    }

    return where;
  }

  // ip-api.com: бесплатно до 1000 запросов/мин, без ключа. Глобальный fetch (Node 20+)
  // вместо отдельной axios-зависимости — она не была установлена и не нужна для одного вызова.
  private async getGeoByIp(ip: string): Promise<{ country?: string; city?: string }> {
    if (['127.0.0.1', '::1', 'localhost'].includes(ip) || ip.startsWith('192.168') || ip.startsWith('10.')) {
      return {};
    }

    try {
      const response = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,status`, {
        signal: AbortSignal.timeout(2000),
      });
      const json = (await response.json()) as { status: string; country?: string; city?: string };
      if (json.status === 'success') {
        return { country: json.country, city: json.city };
      }
    } catch (error) {
      this.logger.warn(`Geo IP lookup failed for ${ip}: ${(error as Error).message}`);
    }
    return {};
  }

  private buildIdentityWhere(
    projectId: string,
    data: Pick<FindOrCreateClientInput, 'tgUserId' | 'waPhone' | 'igUserId'>,
  ) {
    if (data.tgUserId) return { projectId, tgUserId: data.tgUserId };
    if (data.waPhone) return { projectId, waPhone: data.waPhone };
    if (data.igUserId) return { projectId, igUserId: data.igUserId };
    throw new Error('findOrCreate requires at least one channel identity (tgUserId/waPhone/igUserId)');
  }
}
