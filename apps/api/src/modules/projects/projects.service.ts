import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { subDays } from 'date-fns';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { dailyBucketSql, resolveStatsPeriod } from '../../common/timezone.util';
import { StatsPeriodDto } from '../../common/dto/stats-period.dto';
import { ChannelsService } from '../channels/channels.service';
import { LINK_PARAM_KEYS, LINK_PARAM_NAME_REGEX } from '../tracking/link-params.const';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

const ELEVATED_ROLES: UserRole[] = [UserRole.OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN];

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private channelsService: ChannelsService,
  ) {}

  // Проект сам "становится" каналом (1:1 с 2026-07-02) — тип и конфигурация канала
  // запрашиваются один раз тут, никогда не добавляются отдельным шагом позже (см.
  // ChannelsController — там больше нет POST / для создания канала).
  async create(companyId: string, dto: CreateProjectDto) {
    // SubscriptionGuard уже проверил лимит до вызова
    const { project, channel } = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          companyId,
          name: dto.name,
          description: dto.description,
          publicToken: nanoid(32),
          secretKey: `sk_live_${nanoid(48)}`,
          allowedDomains: dto.allowedDomains || [],
          timezone: dto.timezone,
        },
      });

      const channel = await tx.channel.create({
        // tgWelcomeButtons — Json-колонка, class-validator-инстанс структурно не совпадает с
        // Prisma.InputJsonValue (см. тот же приём в ChannelsService.update/PushesService).
        data: {
          projectId: project.id,
          name: dto.name,
          ...dto.channel,
          tgWelcomeButtons: dto.channel.tgWelcomeButtons
            ? (dto.channel.tgWelcomeButtons as unknown as Prisma.InputJsonValue)
            : undefined,
        },
      });

      await tx.company.update({
        where: { id: companyId },
        data: { currentProjects: { increment: 1 } },
      });

      return { project, channel };
    });

    // Вне транзакции — initialize() дёргает внешний API (Telegram/360dialog/Meta),
    // не должен держать открытой DB-транзакцию. Ошибка (невалидный токен и т.п.) не должна
    // блокировать создание проекта — tryInitialize сама ловит исключение и пишет
    // lastError/isActive:false, а не бросает (см. ChannelsService.tryInitialize).
    const initializedChannel = await this.channelsService.tryInitialize(channel);

    // Автоимпорт имени — только для Telegram, только когда initialize() реально вернул
    // название (PERSONAL_DM и неудачный initialize() оставляют оба поля пустыми — тогда
    // остаётся fallback-имя, которое ввёл пользователь). WhatsApp/Instagram профиль сейчас
    // не фетчится вообще — вне рамок этой задачи, см. план "Project ↔ Channel: 1:1".
    const fetchedName =
      initializedChannel.type === 'TELEGRAM'
        ? initializedChannel.tgChannelTitle || initializedChannel.tgBotFirstName
        : null;

    if (fetchedName) {
      await this.prisma.channel.update({ where: { id: initializedChannel.id }, data: { name: fetchedName } });
      await this.prisma.project.update({ where: { id: project.id }, data: { name: fetchedName } });
    }

    return this.findOne(project.id, companyId);
  }

  // Список ID доступных проектов без лишних include (запрос пользователя 2026-07-19,
  // глобальный календарь рассылок по всей компании) — тот же elevatedRoles-паттерн, что и
  // findAll ниже и AudienceService.getAccessibleProjectIds (тот держит свою копию, т.к.
  // AudienceModule ходит к ProjectsService через ModuleRef — см. память про циклы импорта;
  // PushesModule импортирует ProjectsModule напрямую, поэтому здесь достаточно публичного
  // метода без обхода).
  async getAccessibleProjectIds(companyId: string, userId: string, role: UserRole): Promise<string[]> {
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

  async findAll(companyId: string, userId: string, role: UserRole) {
    // OWNER/ADMIN/SUPER_ADMIN видят все проекты компании
    const elevatedRoles: UserRole[] = ELEVATED_ROLES;
    const projects = elevatedRoles.includes(role)
      ? await this.prisma.project.findMany({
          where: { companyId, deletedAt: null },
          include: {
            channel: { select: { id: true, type: true, isActive: true, tgAvatarFileId: true, tgSessionEncrypted: true } },
            pixels: { select: { id: true, platform: true, pixelId: true, label: true, isActive: true } },
            _count: { select: { pushes: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
      : // BUYER/OPERATOR видят только назначенные проекты (ProjectAccess)
        await this.prisma.project.findMany({
          where: { companyId, deletedAt: null, projectAccess: { some: { userId } } },
          include: {
            channel: { select: { id: true, type: true, isActive: true, tgSessionEncrypted: true } },
            pixels: { select: { id: true, platform: true, pixelId: true, label: true, isActive: true } },
            _count: { select: { pushes: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

    const metrics = await this.getClientMetricsByProject(projects.map((p) => p.id));
    return projects.map((p) => ({
      ...p,
      channel: this.sanitizeChannel(p.channel),
      _count: { ...p._count, clients: metrics.get(p.id)?.total ?? 0 },
      activeClientsCount: metrics.get(p.id)?.active ?? 0,
    }));
  }

  // Убираем зашифрованную MTProto-сессию из ответа (тот же приём, что и в
  // ChannelsController.sanitizeChannel) — карточке/странице проекта достаточно знать сам факт
  // подключения личного аккаунта (запрос пользователя 2026-07-21: "значок если добавлен личный
  // аккаунт телеграм"), показывать ciphertext незачем.
  private sanitizeChannel<T extends { tgSessionEncrypted?: string | null } | null>(channel: T) {
    if (!channel) return channel;
    const { tgSessionEncrypted, ...safe } = channel;
    return { ...safe, tgPersonalConnected: !!tgSessionEncrypted };
  }

  // Карточка проекта (список проектов + главная страница) раньше считала клиентов иначе,
  // чем страница самого проекта (ClientsRepository.getProjectStats) — там `count({deletedAt:
  // null})` без фильтра по subscribedAt, здесь — с "только наши" (subscribedAt: not null),
  // из-за чего числа расходились (баг-репорт пользователя 2026-07-17: "в карточке проекта
  // пишет другие цифры клиентов и активных клиентов, не как внутри страницы проекта"). Тот
  // же фильтр "ours only", что и в getProjectStats — единый источник правды для обоих мест.
  // "Активировавшие бота" убраны из карточки по запросу пользователя 2026-07-18 ("убери из
  // карточки... добавь внутри страницы проекта") — метрика осталась только в
  // ClientsRepository.getProjectStats (страница проекта).
  private async getClientMetricsByProject(
    projectIds: string[],
  ): Promise<Map<string, { total: number; active: number }>> {
    if (projectIds.length === 0) return new Map();

    const [totalGroups, activeGroups] = await Promise.all([
      this.prisma.client.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, deletedAt: null, subscribedAt: { not: null } },
        _count: true,
      }),
      this.prisma.client.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, deletedAt: null, subscribedAt: { not: null }, isBotActive: true },
        _count: true,
      }),
    ]);

    const map = new Map<string, { total: number; active: number }>();
    for (const id of projectIds) map.set(id, { total: 0, active: 0 });
    for (const g of totalGroups) map.get(g.projectId)!.total = g._count;
    for (const g of activeGroups) map.get(g.projectId)!.active = g._count;
    return map;
  }

  // Намеренно findFirst с явным companyId в where, а не findUnique по id:
  // PrismaService middleware авто-скоупит только findFirst/findMany/count/aggregate,
  // findUnique он не трогает — использование findUnique здесь дало бы межтенантную утечку.
  async findOne(id: string, companyId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        channel: {
          select: {
            id: true,
            type: true,
            isActive: true,
            lastError: true,
            tgMode: true,
            tgBotUsername: true,
            tgChannelUsername: true,
            tgPersonalUsername: true,
            tgBotFirstName: true,
            tgChannelTitle: true,
            tgChannelMembersCount: true,
            tgAvatarFileId: true,
            tgSessionEncrypted: true,
          },
        },
        pixels: { select: { id: true, platform: true, pixelId: true, label: true, isActive: true } },
        _count: { select: { pushes: true } },
      },
    });
    if (!project) throw new NotFoundException('Проект не найден');

    // Тот же фильтр "ours only" (subscribedAt: not null), что и в findAll/getProjectStats —
    // раньше здесь считались все клиенты без разбора (баг-репорт пользователя 2026-07-17
    // про расхождение цифр карточки/страницы проекта).
    const metrics = await this.getClientMetricsByProject([project.id]);
    return {
      ...project,
      channel: this.sanitizeChannel(project.channel),
      _count: { ...project._count, clients: metrics.get(project.id)?.total ?? 0 },
      activeClientsCount: metrics.get(project.id)?.active ?? 0,
    };
  }

  // Проверка доступа конкретного пользователя к конкретному проекту (Team/роли, запрос
  // пользователя 2026-07-04, Фаза 1) — вызывается из контроллеров, где Buyer/Operator должны
  // быть ограничены только назначенными им проектами (ProjectAccess), в отличие от Owner/
  // Admin/SuperAdmin, у которых доступ ко всем проектам компании без исключений.
  // Точечно применяется в самых используемых ежедневно контроллерах (landings/channels/
  // pushes/clients) — не на все ~99 роутов API сразу, список расширяется по необходимости.
  async assertAccess(projectId: string, companyId: string, userId: string, role: UserRole): Promise<void> {
    await this.findOne(projectId, companyId); // бросит 404, если проект не в этой компании

    if (role === UserRole.OWNER || role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN) return;

    const access = await this.prisma.projectAccess.findUnique({
      where: { userId_projectId: { userId, projectId } },
    });
    if (!access) throw new ForbiddenException('Нет доступа к этому проекту');
  }

  // Без авторизации (companyId) — вызывается из публичных tracking-эндпоинтов,
  // где сам токен и есть аутентификация. Контекста AsyncLocalStorage там нет,
  // поэтому deletedAt:null указан явно, а не в надежде на middleware.
  // channel — нужен TrackingController.tgRedirect (см. telegram-link.util.ts), чтобы
  // построить tg://-ссылку без дополнительного запроса.
  async findByPublicToken(publicToken: string) {
    return this.prisma.project.findFirst({
      where: { publicToken, deletedAt: null },
      include: {
        channel: {
          select: { type: true, tgMode: true, tgBotUsername: true, tgChannelUsername: true, tgPersonalUsername: true, tgInviteLink: true },
        },
      },
    });
  }

  async findById(id: string) {
    return this.prisma.project.findFirst({ where: { id, deletedAt: null } });
  }

  async update(id: string, companyId: string, dto: UpdateProjectDto) {
    await this.findOne(id, companyId); // проверка владения + 404

    if (dto.linkParamMap) this.validateLinkParamMap(dto.linkParamMap);

    return this.prisma.project.update({
      where: { id },
      data: dto as Prisma.ProjectUpdateInput,
    });
  }

  // Кастомные имена query-параметров трекинг-ссылки (запрос пользователя 2026-07-04) — только
  // известные семантические ключи и только безопасные для query-строки символы, чтобы ссылку
  // можно было собирать конкатенацией строк без экранирования (см. link-params.const.ts).
  private validateLinkParamMap(map: Record<string, string>): void {
    for (const [key, value] of Object.entries(map)) {
      if (!(LINK_PARAM_KEYS as readonly string[]).includes(key)) {
        throw new BadRequestException(`Неизвестный параметр ссылки: ${key}`);
      }
      if (typeof value !== 'string' || !LINK_PARAM_NAME_REGEX.test(value)) {
        throw new BadRequestException(`Недопустимое имя параметра для "${key}": разрешены только буквы, цифры и подчёркивание`);
      }
    }
  }

  async regenerateTokens(id: string, companyId: string) {
    await this.findOne(id, companyId);

    return this.prisma.project.update({
      where: { id },
      data: {
        publicToken: nanoid(32),
        secretKey: `sk_live_${nanoid(48)}`,
      },
    });
  }

  async archive(id: string, companyId: string) {
    await this.findOne(id, companyId);

    await this.prisma.project.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });

    await this.prisma.company.update({
      where: { id: companyId },
      data: { currentProjects: { decrement: 1 } },
    });
  }

  async getSnippet(id: string, companyId: string) {
    const project = await this.findOne(id, companyId);
    const apiUrl = `${process.env.API_URL}/api/v1`;

    // data-api-url обязателен: track.js хостится на отдельном CDN-домене (apps/sdk,
    // см. CDN_URL), а не на одном origin с API — без него browser.ts не знает, куда стучаться.
    const snippet = `<!-- TrafficCRM Tracking -->
<script src="${process.env.CDN_URL}/track.js"
        data-project-id="${project.publicToken}"
        data-api-url="${apiUrl}"
        async>
</script>`;

    const apiExample = `// Server-side (Node.js) — npm install @trafficcrm/sdk
const { TrackClient } = require('@trafficcrm/sdk');

const track = new TrackClient({
  projectId: '${project.id}',
  secretKey: '${project.secretKey}',  // KEEP SECRET!
  apiUrl: '${apiUrl}',
});

// Track purchase
await track.purchase(99.00, 'USD', {
  orderId: 'order_123',
  email: customer.email,
});`;

    // REST напрямую (без npm-пакета) — для языков без отдельного SDK. Подпись и
    // формат тела зеркалят apps/api/src/modules/tracking/tracking.controller.ts
    // (trackServerEvent) ровно — это рабочий, проверенный живым тестом контракт.
    const phpExample = `<?php
$secretKey = '${project.secretKey}'; // KEEP SECRET!
$projectId = '${project.id}';
$timestamp = (string)(round(microtime(true) * 1000));

$body = json_encode([
    'eventName' => 'Purchase',
    'value' => 99.00,
    'currency' => 'USD',
    'orderId' => 'order_123',
]);

$signature = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $body, $secretKey);

$ch = curl_init('${apiUrl}/track/server/' . $projectId . '/event');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        "X-Signature: {$signature}",
        "X-Timestamp: {$timestamp}",
    ],
]);
curl_exec($ch);`;

    const pythonExample = `import hmac, hashlib, json, time, requests

secret_key = '${project.secretKey}'  # KEEP SECRET!
project_id = '${project.id}'
timestamp = str(int(time.time() * 1000))

body = json.dumps({
    'eventName': 'Purchase',
    'value': 99.00,
    'currency': 'USD',
    'orderId': 'order_123',
})

signature = 'sha256=' + hmac.new(
    secret_key.encode(),
    f'{timestamp}.{body}'.encode(),
    hashlib.sha256,
).hexdigest()

requests.post(
    '${apiUrl}/track/server/' + project_id + '/event',
    headers={
        'Content-Type': 'application/json',
        'X-Signature': signature,
        'X-Timestamp': timestamp,
    },
    data=body,
)`;

    return { snippet, apiExample, phpExample, pythonExample, publicToken: project.publicToken };
  }

  async getOverview(id: string, companyId: string, days = 30) {
    const project = await this.findOne(id, companyId); // проверка владения + 404
    const since = subDays(new Date(), days);
    // Часовой пояс проекта (запрос пользователя 2026-07-04) — "сутки" на графике событий
    // считаются по нему, не по UTC, см. common/timezone.util.ts.
    const eventBucket = dailyBucketSql('eventTime', project.timezone);

    const [totalClients, newClients, totalRevenue, eventsByDay] = await Promise.all([
      this.prisma.client.count({ where: { projectId: id, deletedAt: null } }),

      this.prisma.client.count({
        where: { projectId: id, deletedAt: null, createdAt: { gte: since } },
      }),

      this.prisma.purchase.aggregate({
        where: { projectId: id },
        _sum: { amount: true },
      }),

      // ::int — Postgres COUNT(*) иначе возвращает bigint, а JSON.stringify не умеет
      // сериализовать BigInt (падало 500-кой "Do not know how to serialize a BigInt",
      // найдено при проверке багрепорта про число подписчиков 2026-07-03). Число событий
      // в проекте за день никогда не подойдёт к переполнению int4.
      this.prisma.$queryRaw`
        SELECT
          ${eventBucket} as date,
          "eventName",
          COUNT(*)::int as count
        FROM "TrackingEvent"
        WHERE "projectId" = ${id}
          AND "eventTime" >= ${since}
        GROUP BY date, "eventName"
        ORDER BY date ASC
      `,
    ]);

    return {
      totalClients,
      newClients,
      totalRevenue: totalRevenue._sum.amount || 0,
      eventsByDay,
    };
  }

  // Разбивка по рекламе/кампании (запрос пользователя 2026-07-04, трекинг-ссылки лендинга
  // "получить ссылку" с ad_id/campaign_id из макросов Facebook/TikTok) — те же 5 стадий, что
  // ClientsRepository.getConversionFunnel, с доп. фильтром по campaignId/adId. PageView/Lead/
  // Purchase считаются по TrackingEvent, Subscribe/Dialogue — по колонкам Client (тот же
  // паттерн, каким уже чинили задвоенный счёт Subscribe, см. память
  // feedback_conversion_funnel_subscribe_bug — только эти два события пишутся в двух местах
  // и рискуют задвоиться, Purchase так не пишется, поэтому остаётся TrackingEvent-based, как
  // и в самой воронке).
  async getAdBreakdown(id: string, companyId: string, periodQuery: StatsPeriodDto) {
    const project = await this.findOne(id, companyId); // проверка владения + 404
    const { since, until } = await resolveStatsPeriod(this.prisma, project.timezone, periodQuery);

    const [eventCombos, clientCombos] = await Promise.all([
      this.prisma.trackingEvent.findMany({
        where: { projectId: id, campaignId: { not: null } },
        select: { campaignId: true, campaignName: true, adId: true, adName: true },
        distinct: ['campaignId', 'adId'],
      }),
      this.prisma.client.findMany({
        where: { projectId: id, deletedAt: null, campaignId: { not: null } },
        select: { campaignId: true, campaignName: true, adId: true, adName: true },
        distinct: ['campaignId', 'adId'],
      }),
    ]);

    const combos = new Map<string, { campaignId: string; campaignName: string | null; adId: string | null; adName: string | null }>();
    for (const c of [...eventCombos, ...clientCombos]) {
      const key = `${c.campaignId}::${c.adId ?? ''}`;
      if (!combos.has(key)) combos.set(key, c as { campaignId: string; campaignName: string | null; adId: string | null; adName: string | null });
    }

    const breakdown = await Promise.all(
      Array.from(combos.values()).map(async (combo) => {
        const scope = { campaignId: combo.campaignId, adId: combo.adId };
        const [pageViews, leads, subscribes, dialogueRows, purchases] = await Promise.all([
          this.prisma.trackingEvent.count({ where: { projectId: id, eventName: 'PageView', createdAt: { gte: since, lt: until }, ...scope } }),
          this.prisma.trackingEvent.count({ where: { projectId: id, eventName: 'Lead', createdAt: { gte: since, lt: until }, ...scope } }),
          this.prisma.client.count({ where: { projectId: id, deletedAt: null, subscribedAt: { gte: since, lt: until }, ...scope } }),
          // CRM-диалог, не любой (тот же баг/фикс, что и в ClientsRepository.getConversionFunnel
          // — см. комментарий там) — здесь campaignId уже сам по себе отсекает большинство
          // холодных контактов (у них обычно нет campaignId, он появляется только через
          // трекинг-ссылку лендинга), но не все: клиент мог посетить лендинг с рекламной
          // меткой, так и не подписаться, и потом написать боту напрямую.
          this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*) as count
            FROM "Client"
            WHERE "projectId" = ${id}
              AND "deletedAt" IS NULL
              AND "campaignId" = ${combo.campaignId}
              AND "adId" IS NOT DISTINCT FROM ${combo.adId}
              AND "firstDialogueAt" >= ${since}
              AND "firstDialogueAt" < ${until}
              AND "subscribedAt" IS NOT NULL
              AND "subscribedAt" <= "firstDialogueAt"
          `,
          this.prisma.trackingEvent.count({ where: { projectId: id, eventName: 'Purchase', createdAt: { gte: since, lt: until }, ...scope } }),
        ]);
        const dialogues = Number(dialogueRows[0]?.count ?? 0);

        return {
          campaignId: combo.campaignId,
          campaignName: combo.campaignName,
          adId: combo.adId,
          adName: combo.adName,
          pageViews,
          leads,
          subscribes,
          dialogues,
          purchases,
          cr: pageViews ? Math.round((purchases / pageViews) * 100 * 10) / 10 : 0,
        };
      }),
    );

    return breakdown.sort((a, b) => b.pageViews - a.pageViews);
  }

  // Топ-5 лидербордов на обзоре проекта (запрос пользователя 2026-07-17: "топ баеров, топ
  // пикселей, топ лэндингов, топ кампаний") — все 4 в одном эндпоинте, чтобы страница делала
  // один запрос вместо четырёх. buyers/campaigns считаются join'ом Client->Purchase (тот же
  // паттерн, что TeamService.getBuyerAnalytics уже использует для компании целиком, здесь —
  // в рамках одного проекта + с периодом); landings — join Landing->Client->Purchase;
  // pixels — по TrackingEvent.pixelId by conversions (без revenue: Purchase не хранит pixelId,
  // а парсить сумму из TrackingEvent.payload ради лидерборда избыточно).
  async getLeaderboards(id: string, companyId: string, periodQuery: StatsPeriodDto) {
    const project = await this.findOne(id, companyId); // проверка владения + 404
    const { since, until } = await resolveStatsPeriod(this.prisma, project.timezone, periodQuery);

    const [buyerRows, users, pixelRows, pixels, landingRows, campaignRows] = await Promise.all([
      this.prisma.$queryRaw<{ buyerId: string; clients: bigint; revenue: string | null }[]>`
        SELECT c."buyerId", COUNT(DISTINCT p."clientId") as clients, COALESCE(SUM(p.amount), 0) as revenue
        FROM "Purchase" p
        JOIN "Client" c ON c.id = p."clientId"
        WHERE p."projectId" = ${id}
          AND p."createdAt" >= ${since} AND p."createdAt" < ${until}
          AND c."buyerId" IS NOT NULL AND c."deletedAt" IS NULL
        GROUP BY c."buyerId"
        ORDER BY revenue DESC
        LIMIT 5
      `,
      this.prisma.user.findMany({ where: { companyId }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.trackingEvent.groupBy({
        by: ['pixelId'],
        where: { projectId: id, eventName: 'Purchase', pixelId: { not: null }, createdAt: { gte: since, lt: until } },
        _count: true,
        orderBy: { _count: { pixelId: 'desc' } },
        take: 5,
      }),
      this.prisma.trackingPixel.findMany({ where: { projectId: id }, select: { id: true, label: true, platform: true } }),
      this.prisma.$queryRaw<{ landing_id: string; name: string; subscribers: bigint; revenue: string | null }[]>`
        SELECT l.id as landing_id, l.name,
          COUNT(DISTINCT c.id) FILTER (WHERE c."subscribedAt" >= ${since} AND c."subscribedAt" < ${until}) as subscribers,
          COALESCE(SUM(p.amount) FILTER (WHERE p."createdAt" >= ${since} AND p."createdAt" < ${until}), 0) as revenue
        FROM "Landing" l
        LEFT JOIN "Client" c ON c."landingId" = l.id AND c."deletedAt" IS NULL
        LEFT JOIN "Purchase" p ON p."clientId" = c.id
        WHERE l."projectId" = ${id} AND l."deletedAt" IS NULL
        GROUP BY l.id, l.name
        ORDER BY revenue DESC, subscribers DESC
        LIMIT 5
      `,
      this.prisma.$queryRaw<{ campaignId: string; campaignName: string | null; clients: bigint; revenue: string | null }[]>`
        SELECT c."campaignId", MAX(c."campaignName") as "campaignName",
          COUNT(DISTINCT c.id) as clients,
          COALESCE(SUM(p.amount), 0) as revenue
        FROM "Client" c
        LEFT JOIN "Purchase" p ON p."clientId" = c.id AND p."createdAt" >= ${since} AND p."createdAt" < ${until}
        WHERE c."projectId" = ${id} AND c."deletedAt" IS NULL AND c."campaignId" IS NOT NULL
        GROUP BY c."campaignId"
        ORDER BY revenue DESC
        LIMIT 5
      `,
    ]);

    const usersById = new Map(users.map((u) => [u.id, u]));
    const pixelsById = new Map(pixels.map((p) => [p.id, p]));

    return {
      buyers: buyerRows.map((r) => {
        const user = usersById.get(r.buyerId);
        return {
          buyerId: r.buyerId,
          name: user ? `${user.firstName} ${user.lastName}`.trim() : 'Удалённый пользователь',
          clients: Number(r.clients),
          revenue: Number(r.revenue || 0),
        };
      }),
      pixels: pixelRows.map((r) => {
        const pixel = r.pixelId ? pixelsById.get(r.pixelId) : undefined;
        return {
          pixelId: r.pixelId,
          label: pixel?.label || pixel?.platform || 'Удалённый пиксель',
          conversions: r._count,
        };
      }),
      landings: landingRows.map((r) => ({
        landingId: r.landing_id,
        name: r.name,
        subscribers: Number(r.subscribers),
        revenue: Number(r.revenue || 0),
      })),
      campaigns: campaignRows.map((r) => ({
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        clients: Number(r.clients),
        revenue: Number(r.revenue || 0),
      })),
    };
  }

  // Логи доставки в пиксели (запрос пользователя 2026-07-04) — "что отправлялось платформе
  // трафика и статус". TrackingEventDelivery уже существовал (создавался в TrackingProcessor
  // для КАЖДОЙ пары событие+пиксель), просто нигде не показывался в UI до сих пор.
  // Показываем TrackingEvent.payload как прокси "что отправили" — сырое тело запроса к
  // Facebook/TikTok (с access_token пикселя) нигде не персистится и не должно, чтобы секрет
  // пикселя не осел в логах; payload — то же самое, из чего FacebookCAPIService/
  // TikTokEventsService строят реальный запрос.
  async getPixelLogs(
    id: string,
    companyId: string,
    filters: { page?: number; limit?: number; pixelId?: string; status?: string; eventName?: string },
  ) {
    await this.findOne(id, companyId); // проверка владения + 404

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 200);

    const where: Prisma.TrackingEventDeliveryWhereInput = {
      event: { projectId: id, ...(filters.eventName ? { eventName: filters.eventName } : {}) },
      ...(filters.pixelId ? { pixelId: filters.pixelId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.trackingEventDelivery.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          status: true,
          error: true,
          externalEventId: true,
          sentAt: true,
          pixel: { select: { id: true, platform: true, label: true, pixelId: true } },
          event: {
            select: {
              eventName: true,
              eventTime: true,
              payload: true,
              adId: true,
              adName: true,
              campaignId: true,
              campaignName: true,
            },
          },
        },
      }),
      this.prisma.trackingEventDelivery.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
