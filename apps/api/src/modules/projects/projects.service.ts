import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { subDays } from 'date-fns';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async create(companyId: string, dto: CreateProjectDto) {
    // SubscriptionGuard уже проверил лимит до вызова
    const project = await this.prisma.project.create({
      data: {
        companyId,
        name: dto.name,
        description: dto.description,
        publicToken: nanoid(32),
        secretKey: `sk_live_${nanoid(48)}`,
        allowedDomains: dto.allowedDomains || [],
      },
    });

    await this.prisma.company.update({
      where: { id: companyId },
      data: { currentProjects: { increment: 1 } },
    });

    return project;
  }

  async findAll(companyId: string, userId: string, role: UserRole) {
    // OWNER/ADMIN/SUPER_ADMIN видят все проекты компании
    const elevatedRoles: UserRole[] = [UserRole.OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN];
    if (elevatedRoles.includes(role)) {
      return this.prisma.project.findMany({
        where: { companyId, deletedAt: null },
        include: {
          channels: { select: { id: true, type: true, isActive: true } },
          pixels: { select: { id: true, platform: true, pixelId: true, label: true, isActive: true } },
          _count: { select: { clients: true, pushes: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    // ADVERTISER видит только назначенные проекты
    return this.prisma.project.findMany({
      where: {
        companyId,
        deletedAt: null,
        projectAccess: { some: { userId } },
      },
      include: {
        channels: { select: { id: true, type: true, isActive: true } },
        pixels: { select: { id: true, platform: true, pixelId: true, label: true, isActive: true } },
        _count: { select: { clients: true, pushes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Намеренно findFirst с явным companyId в where, а не findUnique по id:
  // PrismaService middleware авто-скоупит только findFirst/findMany/count/aggregate,
  // findUnique он не трогает — использование findUnique здесь дало бы межтенантную утечку.
  async findOne(id: string, companyId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        channels: {
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
          },
        },
        pixels: { select: { id: true, platform: true, pixelId: true, label: true, isActive: true } },
        _count: { select: { clients: true, pushes: true } },
      },
    });
    if (!project) throw new NotFoundException('Проект не найден');
    return project;
  }

  // Без авторизации (companyId) — вызывается из публичных tracking-эндпоинтов,
  // где сам токен и есть аутентификация. Контекста AsyncLocalStorage там нет,
  // поэтому deletedAt:null указан явно, а не в надежде на middleware.
  async findByPublicToken(publicToken: string) {
    return this.prisma.project.findFirst({ where: { publicToken, deletedAt: null } });
  }

  async findById(id: string) {
    return this.prisma.project.findFirst({ where: { id, deletedAt: null } });
  }

  async update(id: string, companyId: string, dto: UpdateProjectDto) {
    await this.findOne(id, companyId); // проверка владения + 404

    return this.prisma.project.update({
      where: { id },
      data: dto,
    });
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
    await this.findOne(id, companyId); // проверка владения + 404
    const since = subDays(new Date(), days);

    const [totalClients, newClients, totalRevenue, eventsByDay] = await Promise.all([
      this.prisma.client.count({ where: { projectId: id } }),

      this.prisma.client.count({
        where: { projectId: id, createdAt: { gte: since } },
      }),

      this.prisma.purchase.aggregate({
        where: { projectId: id },
        _sum: { amount: true },
      }),

      this.prisma.$queryRaw`
        SELECT
          DATE("eventTime") as date,
          "eventName",
          COUNT(*) as count
        FROM "TrackingEvent"
        WHERE "projectId" = ${id}
          AND "eventTime" >= ${since}
        GROUP BY DATE("eventTime"), "eventName"
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
}
