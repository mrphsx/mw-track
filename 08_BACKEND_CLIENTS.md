# 08 — Backend: CRM Клиентов — Полная реализация

## Задача для Claude Code
Реализуй полноценный CRM модуль для хранения, поиска, фильтрации и экспорта клиентов.

---

## Clients Module структура

```
modules/clients/
├── clients.module.ts
├── clients.controller.ts
├── clients.service.ts
├── clients.repository.ts    — сложные SQL запросы
└── dto/
    ├── client-filters.dto.ts
    ├── create-client.dto.ts
    ├── update-client.dto.ts
    └── push-filter.dto.ts
```

---

## Clients Repository (сложные запросы)

```typescript
// modules/clients/clients.repository.ts

@Injectable()
export class ClientsRepository {
  constructor(private readonly prisma: PrismaService) {}
  
  // Статистика для дашборда проекта
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
      
      // Всего клиентов
      this.prisma.client.count({
        where: { projectId, deletedAt: null }
      }),
      
      // Активных (бот не заблокирован)
      this.prisma.client.count({
        where: { projectId, deletedAt: null, isBotActive: true }
      }),
      
      // Новых за период
      this.prisma.client.count({
        where: { projectId, deletedAt: null, createdAt: { gte: since } }
      }),
      
      // С хотя бы одной покупкой
      this.prisma.client.count({
        where: { projectId, deletedAt: null, hasPurchase: true }
      }),
      
      // Общая выручка
      this.prisma.purchase.aggregate({
        where: { projectId },
        _sum: { amount: true },
        _avg: { amount: true },
      }),
      
      // Средний чек
      this.prisma.purchase.aggregate({
        where: { projectId, createdAt: { gte: since } },
        _avg: { amount: true },
      }),
      
      // Разбивка по каналам
      this.prisma.client.groupBy({
        by: ['channelType'],
        where: { projectId, deletedAt: null },
        _count: { _all: true },
      }),
      
      // Разбивка по странам (топ 10)
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
      
      // Новые подписчики по дням
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
      conversionRate: totalClients > 0 
        ? Math.round((clientsWithPurchase / totalClients) * 100 * 10) / 10 
        : 0,
      totalRevenue: Number(totalRevenue._sum.amount || 0),
      avgOrderValue: Number(avgRevenue._avg.amount || 0),
      channelBreakdown: channelBreakdown.map(c => ({
        channel: c.channelType,
        count: c._count._all,
      })),
      countryBreakdown: countryBreakdown.map(c => ({
        country: c.country,
        count: Number(c.count),
      })),
      dailySubscribers: dailySubscribers.map(d => ({
        date: d.date,
        count: Number(d.count),
      })),
    };
  }
  
  // Воронка конверсий
  async getConversionFunnel(projectId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const [pageViews, leads, subscribes, purchases] = await Promise.all([
      this.prisma.trackingEvent.count({
        where: { projectId, eventName: 'PageView', createdAt: { gte: since } }
      }),
      this.prisma.trackingEvent.count({
        where: { projectId, eventName: 'Lead', createdAt: { gte: since } }
      }),
      this.prisma.trackingEvent.count({
        where: { projectId, eventName: 'Subscribe', createdAt: { gte: since } }
      }),
      this.prisma.trackingEvent.count({
        where: { projectId, eventName: 'Purchase', createdAt: { gte: since } }
      }),
    ]);
    
    return [
      { stage: 'PageView', count: pageViews, label: 'Просмотры лендинга' },
      { stage: 'Lead', count: leads, label: 'Клик на кнопку', rate: pageViews ? Math.round(leads/pageViews*100) : 0 },
      { stage: 'Subscribe', count: subscribes, label: 'Вступили в канал', rate: leads ? Math.round(subscribes/leads*100) : 0 },
      { stage: 'Purchase', count: purchases, label: 'Совершили покупку', rate: subscribes ? Math.round(purchases/subscribes*100) : 0 },
    ];
  }
  
  // Поиск клиентов для Lookalike Export
  async getClientsForLookalikeExport(projectId: string, onlyBuyers = true) {
    return this.prisma.client.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(onlyBuyers ? { hasPurchase: true } : {}),
        // Для Lookalike нужны хоть какие-то данные
        OR: [
          { email: { not: null } },
          { tgUserId: { not: null } },
          { waPhone: { not: null } },
        ]
      },
      select: {
        email: true,
        phone: true,
        waPhone: true,
        country: true,
        // НЕ включаем Telegram ID (FB его не знает)
      }
    });
  }
}
```

---

## Clients Service

```typescript
// modules/clients/clients.service.ts

@Injectable()
export class ClientsService {
  
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ClientsRepository,
    @InjectQueue('tracking-events') private readonly trackingQueue: Queue,
  ) {}
  
  // Найти или создать клиента (главный метод, вызывается из Channel Providers)
  async findOrCreate(data: CreateClientDto): Promise<{ client: Client; isNew: boolean }> {
    const where = this.buildUniqueQuery(data);
    
    const existing = await this.prisma.client.findFirst({ where });
    
    if (existing) {
      // Обновить lastActiveAt и другие данные
      const updated = await this.prisma.client.update({
        where: { id: existing.id },
        data: {
          lastActiveAt: new Date(),
          // Обновить UTM если новые есть
          ...(data.utmSource && !existing.utmSource ? { utmSource: data.utmSource } : {}),
          ...(data.fbclid && !existing.fbclid ? { fbclid: data.fbclid } : {}),
          ...(data.ttclid && !existing.ttclid ? { ttclid: data.ttclid } : {}),
        }
      });
      return { client: updated, isNew: false };
    }
    
    // Получить geo данные по IP
    let geoData: { country?: string; city?: string } = {};
    if (data.ipAddress) {
      geoData = await this.getGeoByIp(data.ipAddress);
    }
    
    const client = await this.prisma.client.create({
      data: {
        ...data,
        ...geoData,
        firstSeenAt: new Date(),
        lastActiveAt: new Date(),
      }
    });
    
    // Обновить счётчик компании
    await this.prisma.company.update({
      where: { id: data.companyId },
      data: { currentClients: { increment: 1 } }
    });
    
    return { client, isNew: true };
  }
  
  // Привязать fbclid к клиенту (когда пришёл через Telegram start code)
  async updateTracking(tgUserId: string, projectId: string, trackingData: TrackingData) {
    const client = await this.prisma.client.findFirst({
      where: { tgUserId, projectId }
    });
    
    if (!client) return;
    
    await this.prisma.client.update({
      where: { id: client.id },
      data: {
        fbclid: trackingData.fbclid || client.fbclid,
        ttclid: trackingData.ttclid || client.ttclid,
        utmSource: trackingData.utmSource || client.utmSource,
        utmMedium: trackingData.utmMedium || client.utmMedium,
        utmCampaign: trackingData.utmCampaign || client.utmCampaign,
        ipAddress: trackingData.ip || client.ipAddress,
      }
    });
  }
  
  // Отметить что клиент заблокировал бота
  async markBotBlocked(channelUserId: string, channelType: ChannelType, projectId: string) {
    const where = channelType === 'TELEGRAM' 
      ? { tgUserId: channelUserId, projectId }
      : { waPhone: channelUserId, projectId };
    
    await this.prisma.client.updateMany({
      where,
      data: { isBotActive: false }
    });
  }
  
  // Отметить что клиент вышел из канала
  async markUnsubscribed(channelUserId: string, channelType: ChannelType, projectId: string) {
    const where = channelType === 'TELEGRAM'
      ? { tgUserId: channelUserId, projectId }
      : {};
    
    await this.prisma.client.updateMany({
      where,
      data: {
        isSubscribed: false,
        unsubscribedAt: new Date(),
      }
    });
  }
  
  // Получить клиентов с фильтрами и пагинацией
  async findMany(projectId: string, filters: ClientFiltersDto) {
    const where: Prisma.ClientWhereInput = {
      projectId,
      deletedAt: null,
    };
    
    // Применить фильтры
    if (filters.channelType) where.channelType = { in: filters.channelType };
    if (typeof filters.hasPurchase === 'boolean') where.hasPurchase = filters.hasPurchase;
    if (typeof filters.isBotActive === 'boolean') where.isBotActive = filters.isBotActive;
    if (typeof filters.isSubscribed === 'boolean') where.isSubscribed = filters.isSubscribed;
    if (filters.country?.length) where.country = { in: filters.country };
    if (filters.utmSource) where.utmSource = filters.utmSource;
    if (filters.utmCampaign) where.utmCampaign = filters.utmCampaign;
    
    if (filters.minSpent !== undefined) {
      where.totalSpent = { gte: filters.minSpent };
    }
    if (filters.maxSpent !== undefined) {
      where.totalSpent = { ...where.totalSpent as any, lte: filters.maxSpent };
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
    
    // Сортировка
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
        include: {
          _count: { select: { purchases: true } }
        }
      }),
      this.prisma.client.count({ where }),
    ]);
    
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
  
  // Экспорт в CSV для Lookalike Audience
  async exportForLookalike(projectId: string, onlyBuyers: boolean): Promise<string> {
    const clients = await this.repository.getClientsForLookalikeExport(projectId, onlyBuyers);
    
    // Формат CSV для Facebook Custom Audience
    const headers = ['email', 'phone', 'country'];
    const rows = clients.map(c => [
      c.email || '',
      c.waPhone || c.phone || '',
      c.country || '',
    ]);
    
    const csv = [
      headers.join(','),
      ...rows.map(r => r.map(v => `"${v}"`).join(','))
    ].join('\n');
    
    return csv;
  }
  
  // Geo IP через бесплатный сервис ip-api.com
  private async getGeoByIp(ip: string): Promise<{ country?: string; city?: string }> {
    // Пропустить локальные адреса
    if (['127.0.0.1', '::1', 'localhost'].includes(ip) || ip.startsWith('192.168')) {
      return {};
    }
    
    try {
      const response = await axios.get(`http://ip-api.com/json/${ip}?fields=country,city,status`, {
        timeout: 2000
      });
      
      if (response.data.status === 'success') {
        return {
          country: response.data.country,
          city: response.data.city,
        };
      }
    } catch {
      // Молча игнорируем ошибки geo
    }
    return {};
  }
  
  private buildUniqueQuery(data: CreateClientDto): Prisma.ClientWhereInput {
    if (data.tgUserId) return { tgUserId: data.tgUserId, projectId: data.projectId };
    if (data.waPhone) return { waPhone: data.waPhone, projectId: data.projectId };
    if (data.igUserId) return { igUserId: data.igUserId, projectId: data.projectId };
    if (data.email) return { email: data.email, projectId: data.projectId };
    throw new Error('At least one identifier required');
  }
}
```

---

## Purchases Service

```typescript
// modules/purchases/purchases.service.ts

@Injectable()
export class PurchasesService {
  
  async create(projectId: string, clientId: string, dto: CreatePurchaseDto, registeredBy?: string) {
    // Проверить идемпотентность
    if (dto.idempotencyKey) {
      const existing = await this.prisma.purchase.findUnique({
        where: { idempotencyKey: dto.idempotencyKey }
      });
      if (existing) return existing;
    }
    
    const purchase = await this.prisma.$transaction(async (tx) => {
      // Создать покупку
      const p = await tx.purchase.create({
        data: {
          projectId,
          clientId,
          amount: dto.amount,
          currency: dto.currency || 'USD',
          externalOrderId: dto.orderId,
          idempotencyKey: dto.idempotencyKey,
          source: dto.source || 'manual',
          registeredBy,
        }
      });
      
      // Обновить статистику клиента
      await tx.client.update({
        where: { id: clientId },
        data: {
          hasPurchase: true,
          totalSpent: { increment: dto.amount },
          purchasesCount: { increment: 1 },
          lastActiveAt: new Date(),
        }
      });
      
      return p;
    });
    
    // Отправить событие Purchase в FB/TT через очередь
    await this.trackingQueue.add('track-event', {
      projectId,
      clientId,
      eventName: 'Purchase',
      payload: {
        value: dto.amount,
        currency: dto.currency || 'USD',
        orderId: dto.orderId,
        idempotencyKey: purchase.id, // используем ID как event_id
      }
    }, {
      priority: 1, // наивысший приоритет
    });
    
    return purchase;
  }
  
  async findByClient(clientId: string) {
    return this.prisma.purchase.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
    });
  }
  
  // Вебхук от внешней платёжной системы клиента
  async handleWebhook(projectId: string, webhookData: ExternalWebhookDto, signature: string) {
    // Найти проект и проверить подпись
    const project = await this.prisma.project.findFirst({
      where: { id: projectId }
    });
    
    const expectedSig = crypto
      .createHmac('sha256', project.secretKey)
      .update(JSON.stringify(webhookData))
      .digest('hex');
    
    if (signature !== expectedSig) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    
    // Найти клиента по telegram_id, phone или email
    const client = await this.clientsService.findByIdentifier(projectId, webhookData);
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    
    return this.create(projectId, client.id, {
      amount: webhookData.amount,
      currency: webhookData.currency,
      orderId: webhookData.orderId,
      idempotencyKey: `webhook_${webhookData.orderId}`,
      source: 'webhook',
    });
  }
}
```

---

## DTOs

```typescript
// modules/clients/dto/client-filters.dto.ts
export class ClientFiltersDto {
  @IsOptional() @IsArray()
  channelType?: ChannelType[];
  
  @IsOptional() @IsBoolean()
  hasPurchase?: boolean;
  
  @IsOptional() @IsBoolean()
  isBotActive?: boolean;
  
  @IsOptional() @IsBoolean()
  isSubscribed?: boolean;
  
  @IsOptional() @IsArray() @IsString({ each: true })
  country?: string[];
  
  @IsOptional() @IsNumber()
  minSpent?: number;
  
  @IsOptional() @IsNumber()
  maxSpent?: number;
  
  @IsOptional() @IsDateString()
  subscribedFrom?: string;
  
  @IsOptional() @IsDateString()
  subscribedTo?: string;
  
  @IsOptional() @IsString()
  utmSource?: string;
  
  @IsOptional() @IsString()
  utmCampaign?: string;
  
  @IsOptional() @IsString()
  search?: string;
  
  @IsOptional() @IsEnum(['createdAt', 'totalSpent', 'lastActive', 'purchases'])
  sortBy?: string;
  
  @IsOptional() @IsNumber() @Min(1)
  page?: number;
  
  @IsOptional() @IsNumber() @Min(1) @Max(200)
  limit?: number;
}

// modules/pushes/dto/push-filter.dto.ts
export class PushFilterDto {
  @IsOptional() @IsArray()
  channelTypes?: ChannelType[];    // null = все каналы
  
  @IsOptional() @IsBoolean()
  hasPurchase?: boolean;           // null = все
  
  @IsOptional() @IsArray() @IsString({ each: true })
  countries?: string[];            // null = все страны
  
  @IsOptional() @IsNumber()
  minSpent?: number;
  
  @IsOptional() @IsDateString()
  subscribedFrom?: string;
  
  @IsOptional() @IsDateString()
  subscribedTo?: string;
  
  @IsOptional() @IsNumber()
  inactiveDaysMin?: number;        // не активен X+ дней
}

// modules/purchases/dto/create-purchase.dto.ts
export class CreatePurchaseDto {
  @IsNumber() @Min(0.01)
  amount: number;
  
  @IsOptional() @IsString()
  currency?: string;
  
  @IsOptional() @IsString()
  orderId?: string;
  
  @IsOptional() @IsString()
  idempotencyKey?: string;
  
  @IsOptional() @IsString()
  source?: 'manual' | 'api' | 'bot' | 'webhook';
}
```

---

## Clients Controller — все endpoints

```typescript
// GET    /api/v1/projects/:id/clients
//   Query params: channelType, hasPurchase, isBotActive, country,
//                 minSpent, subscribedFrom, subscribedTo, search,
//                 sortBy, page, limit
// Возвращает: { items, total, page, totalPages }

// GET    /api/v1/projects/:id/clients/stats
// Возвращает: totalClients, activeClients, newClients, totalRevenue, etc.

// GET    /api/v1/projects/:id/clients/funnel
// Возвращает: воронку PageView → Lead → Subscribe → Purchase

// GET    /api/v1/projects/:id/clients/export/lookalike
//   Query: onlyBuyers=true|false
// Возвращает: CSV файл для Facebook

// GET    /api/v1/projects/:id/clients/:clientId
// Возвращает: полный профиль клиента

// GET    /api/v1/projects/:id/clients/:clientId/purchases
// Возвращает: историю покупок клиента

// GET    /api/v1/projects/:id/clients/:clientId/events
// Возвращает: историю событий (PageView, Lead, etc.)

// GET    /api/v1/projects/:id/clients/:clientId/pushes
// Возвращает: какие пуши получал клиент

// POST   /api/v1/projects/:id/clients/:clientId/purchases
// Тело: { amount, currency, orderId }
// Действие: добавить покупку вручную

// DELETE /api/v1/projects/:id/clients/:clientId
// Действие: soft delete (GDPR удаление)

// Purchases endpoints:
// POST   /api/v1/webhooks/purchase/:projectId
//   Headers: X-Signature: sha256=...
//   Действие: вебхук от внешней платёжки
```

---

## Покупки через Telegram бот (команда)

```typescript
// В Telegram Provider добавить обработчик команды /purchase:

bot.command('purchase', async (ctx) => {
  // Только для администраторов бота (проверить что это рекламщик/админ)
  // Формат: /purchase @username 150 USD
  // или: /purchase 123456789 99.99
  
  const args = ctx.match?.split(' ') || [];
  
  if (args.length < 2) {
    await ctx.reply(
      '❌ Неверный формат.\n' +
      'Используй: /purchase @username 150\n' +
      'или: /purchase 123456789 150 USD'
    );
    return;
  }
  
  const identifier = args[0]; // @username или telegram_id
  const amount = parseFloat(args[1]);
  const currency = args[2] || 'USD';
  
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Неверная сумма');
    return;
  }
  
  // Найти клиента
  let client: Client | null = null;
  
  if (identifier.startsWith('@')) {
    client = await this.clientsService.findByUsername(
      identifier.slice(1),
      channel.projectId
    );
  } else {
    client = await this.clientsService.findByTgId(
      identifier,
      channel.projectId
    );
  }
  
  if (!client) {
    await ctx.reply(`❌ Клиент ${identifier} не найден в базе`);
    return;
  }
  
  // Зарегистрировать покупку
  await this.purchasesService.create(
    channel.projectId,
    client.id,
    { amount, currency, source: 'bot' }
  );
  
  const name = client.tgFirstName || client.tgUsername || 'Клиент';
  await ctx.reply(
    `✅ Покупка зарегистрирована!\n` +
    `👤 ${name}\n` +
    `💰 ${amount} ${currency}\n` +
    `📊 Данные отправлены в Facebook`
  );
});
```

---

## Дополнительные зависимости

```bash
cd apps/api
npm install axios  # для geo IP запросов (уже должен быть)
# ip-api.com используется без API ключа (бесплатно до 1000 запросов/мин)
# В продакшне можно заменить на MaxMind GeoLite2 (локальная база, быстрее)
```

## Опциональная оптимизация: GeoLite2 (локальная geo база)

```bash
npm install @maxmind/geoip2-node
# Скачать базу данных GeoLite2-City.mmdb с maxmind.com (бесплатно, нужна регистрация)
# Хранить в /data/GeoLite2-City.mmdb
# Обновлять автоматически раз в неделю через cron
```

```typescript
// Замена для ip-api.com (работает локально, без внешних запросов)
private reader: Reader;

async onModuleInit() {
  this.reader = await Reader.open('/data/GeoLite2-City.mmdb');
}

private async getGeoByIp(ip: string) {
  try {
    const result = this.reader.city(ip);
    return {
      country: result.country?.names?.en,
      city: result.city?.names?.en,
    };
  } catch {
    return {};
  }
}
```
