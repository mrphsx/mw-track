import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BotLinkSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { buildBotLinkUrl, generateBotLinkCode } from '../channels/bot-link.util';
import { resolveFunnelConfig } from '../../common/funnel-config';

export interface BotLinkInput {
  name: string;
  source: BotLinkSource;
  buyerId?: string | null;
  pixelId?: string | null;
}

interface LinkStatsRow {
  botLinkId: string;
  leads: bigint;
  dialogues: bigint;
  depositors: bigint;
  revenue: Prisma.Decimal | null;
}

// Ссылки на бота для трафика без лендинга (запрос пользователя 2026-10-23) — см. BotLink в
// schema.prisma и разбор start-параметра в TelegramProvider.handleStart.
@Injectable()
export class BotLinksService {
  constructor(private prisma: PrismaService) {}

  // Ссылки имеют смысл только для бота в режиме «сразу в бота»: в остальных режимах бот лишь
  // пропускает в канал, и прямой переход в него лидом не считается.
  private async requireDirectBot(projectId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { projectId },
      select: { type: true, tgMode: true, tgBotUsername: true },
    });
    if (!channel || channel.type !== 'TELEGRAM' || channel.tgMode !== 'BOT_DIRECT' || !channel.tgBotUsername) {
      throw new BadRequestException('Ссылки на бота доступны для проектов с ботом в режиме «Сразу в бота»');
    }
    return channel.tgBotUsername;
  }

  // pixelOwnerId — баер с видимостью «только свои пиксели» (2026-10-24) может привязать к ссылке
  // только свой пиксель.
  private async assertRefs(companyId: string, projectId: string, input: Partial<BotLinkInput>, pixelOwnerId?: string) {
    if (input.buyerId) {
      const buyer = await this.prisma.user.findFirst({ where: { id: input.buyerId, companyId, deletedAt: null }, select: { id: true } });
      if (!buyer) throw new BadRequestException('Баер не найден');
    }
    if (input.pixelId) {
      const pixel = await this.prisma.trackingPixel.findFirst({
        where: { id: input.pixelId, projectId, ...(pixelOwnerId ? { createdById: pixelOwnerId } : {}) },
        select: { id: true },
      });
      if (!pixel) throw new BadRequestException('Пиксель не найден в этом проекте');
    }
  }

  async list(projectId: string, companyId: string, scopedBuyerId?: string) {
    const channel = await this.prisma.channel.findUnique({ where: { projectId }, select: { type: true, tgBotUsername: true, tgMode: true, tgDirectTraffic: true } });
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { funnelConfig: true } });
    const funnel = resolveFunnelConfig(project?.funnelConfig ?? null, channel);
    const links = await this.prisma.botLink.findMany({
      where: { projectId, companyId, deletedAt: null, ...(scopedBuyerId ? { buyerId: scopedBuyerId } : {}) },
      orderBy: { createdAt: 'desc' },
    });

    // Те же определения, что у остальной статистики проекта: лид — клиент с subscribedAt, диалог
    // — с firstDialogueAt, депозитор — hasPurchase; удалённые клиенты не считаются.
    const stats = links.length
      ? await this.prisma.$queryRaw<LinkStatsRow[]>`
          SELECT "botLinkId",
            COUNT(*) FILTER (WHERE "subscribedAt" IS NOT NULL) AS leads,
            COUNT(*) FILTER (WHERE "subscribedAt" IS NOT NULL AND "firstDialogueAt" IS NOT NULL) AS dialogues,
            COUNT(*) FILTER (WHERE "subscribedAt" IS NOT NULL AND "hasPurchase") AS depositors,
            SUM("totalSpent") FILTER (WHERE "subscribedAt" IS NOT NULL) AS revenue
          FROM "Client"
          WHERE "projectId" = ${projectId} AND "deletedAt" IS NULL
            AND "botLinkId" IN (${Prisma.join(links.map((l) => l.id))})
          GROUP BY "botLinkId"
        `
      : [];
    const statsById = new Map(stats.map((s) => [s.botLinkId, s]));

    const buyerIds = [...new Set(links.map((l) => l.buyerId).filter((v): v is string => !!v))];
    const pixelIds = [...new Set(links.map((l) => l.pixelId).filter((v): v is string => !!v))];
    const [buyers, pixels] = await Promise.all([
      buyerIds.length ? this.prisma.user.findMany({ where: { id: { in: buyerIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [],
      pixelIds.length ? this.prisma.trackingPixel.findMany({ where: { id: { in: pixelIds } }, select: { id: true, label: true, platform: true, pixelId: true } }) : [],
    ]);
    const buyerName = new Map<string, string>(buyers.map((b): [string, string] => [b.id, [b.firstName, b.lastName].filter(Boolean).join(' ') || b.email]));
    const pixelLabel = new Map<string, string>(pixels.map((p): [string, string] => [p.id, p.label || `${p.platform} ${p.pixelId}`]));

    return {
      botUsername: channel?.tgBotUsername ?? null,
      available: channel?.tgMode === 'BOT_DIRECT' && !!channel.tgBotUsername,
      // Кто из нажавших Start — лид (воронка проекта, 2026-10-24).
      leadBotStart: funnel.leadBotStart,
      items: links.map((l) => {
        const s = statsById.get(l.id);
        return {
          id: l.id,
          name: l.name,
          code: l.code,
          source: l.source,
          buyerId: l.buyerId,
          buyerName: l.buyerId ? buyerName.get(l.buyerId) ?? null : null,
          pixelId: l.pixelId,
          pixelLabel: l.pixelId ? pixelLabel.get(l.pixelId) ?? null : null,
          url: channel?.tgBotUsername ? buildBotLinkUrl(channel.tgBotUsername, l.code, l.source) : null,
          createdAt: l.createdAt,
          leads: Number(s?.leads ?? 0),
          dialogues: Number(s?.dialogues ?? 0),
          depositors: Number(s?.depositors ?? 0),
          revenue: Number(s?.revenue ?? 0),
        };
      }),
    };
  }

  async create(projectId: string, companyId: string, userId: string, input: BotLinkInput, pixelOwnerId?: string) {
    await this.requireDirectBot(projectId);
    await this.assertRefs(companyId, projectId, input, pixelOwnerId);
    // Код уникален глобально (по нему /start находит ссылку) — при редком совпадении берём другой.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.botLink.create({
          data: {
            companyId,
            projectId,
            name: input.name.trim(),
            code: generateBotLinkCode(),
            source: input.source,
            buyerId: input.buyerId || null,
            pixelId: input.pixelId || null,
            createdById: userId,
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    }
    throw new BadRequestException('Не удалось создать ссылку, попробуйте ещё раз');
  }

  async findOne(projectId: string, companyId: string, linkId: string) {
    const link = await this.prisma.botLink.findFirst({ where: { id: linkId, projectId, companyId, deletedAt: null } });
    if (!link) throw new NotFoundException('Ссылка не найдена');
    return link;
  }

  // Код не меняется: ссылка уже может стоять в рекламе.
  async update(projectId: string, companyId: string, linkId: string, input: Partial<BotLinkInput>, pixelOwnerId?: string) {
    await this.findOne(projectId, companyId, linkId);
    await this.assertRefs(companyId, projectId, input, pixelOwnerId);
    return this.prisma.botLink.update({
      where: { id: linkId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.buyerId !== undefined ? { buyerId: input.buyerId || null } : {}),
        ...(input.pixelId !== undefined ? { pixelId: input.pixelId || null } : {}),
      },
    });
  }

  // Мягкое удаление: по ссылке больше никто не становится лидом через неё, но уже пришедшие
  // клиенты сохраняют botLinkId и свою статистику.
  async remove(projectId: string, companyId: string, linkId: string) {
    await this.findOne(projectId, companyId, linkId);
    await this.prisma.botLink.update({ where: { id: linkId }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}
