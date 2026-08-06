import { InjectQueue } from '@nestjs/bull';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Channel, PersonalBroadcast, Prisma, PersonalBroadcastStatus } from '@prisma/client';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { checkSubscriptionLimit } from '../../common/guards/subscription.util';
import { TelegramPersonalService } from '../channels/providers/telegram-personal.service';
import { PersonalBroadcastFilterDto } from './dto/personal-broadcast-filter.dto';
import { CreatePersonalBroadcastDto } from './dto/create-personal-broadcast.dto';

const ACTIVE_STATUSES: PersonalBroadcastStatus[] = ['DRAFT', 'SCHEDULED', 'SENDING'];

@Injectable()
export class PersonalBroadcastsService {
  constructor(
    private prisma: PrismaService,
    private personal: TelegramPersonalService,
    @InjectQueue('personal-broadcast-messages') private queue: Queue,
  ) {}

  private async getPersonalChannel(projectId: string): Promise<Channel | null> {
    const channel = await this.prisma.channel.findFirst({ where: { projectId } });
    if (!channel || !channel.tgSessionEncrypted) return null;
    return channel;
  }

  // Живые папки Telegram (запрос пользователя: "по папкам которые уже созданы в телеграме") —
  // без кеша в БД, фетчатся заново на каждое открытие формы создания.
  async getFolders(projectId: string): Promise<{ id: number; title: string }[]> {
    const channel = await this.getPersonalChannel(projectId);
    if (!channel) return [];
    return this.personal.getDialogFilters(channel);
  }

  // Аудитория всегда начинается с dialogueSource='PERSONAL_ACCOUNT' — это единственный
  // безусловный признак "реальный диалог именно с личным аккаунтом" (запрос пользователя:
  // "рассылку всем у кого есть диалог"), см. находки в плане про DialogueSource. Живая проверка
  // "диалог реально есть" происходит ВТОРОЙ раз, непосредственно перед отправкой каждому
  // получателю — см. PersonalBroadcastsProcessor/TelegramPersonalService.sendDirectMessage.
  private async buildAudienceWhere(projectId: string, filter: PersonalBroadcastFilterDto): Promise<Prisma.ClientWhereInput> {
    const where: Prisma.ClientWhereInput = {
      projectId,
      deletedAt: null,
      dialogueSource: 'PERSONAL_ACCOUNT',
      tgUserId: { not: null },
    };

    if (filter.dialogueSince || filter.dialogueUntil) {
      where.lastDialogueAt = {
        ...(filter.dialogueSince ? { gte: new Date(filter.dialogueSince) } : {}),
        ...(filter.dialogueUntil ? { lte: new Date(filter.dialogueUntil) } : {}),
      };
    }

    if (typeof filter.hasPurchase === 'boolean') where.hasPurchase = filter.hasPurchase;

    if (filter.minPurchasesCount !== undefined || filter.maxPurchasesCount !== undefined) {
      where.purchasesCount = {
        ...(filter.minPurchasesCount !== undefined ? { gte: filter.minPurchasesCount } : {}),
        ...(filter.maxPurchasesCount !== undefined ? { lte: filter.maxPurchasesCount } : {}),
      };
    }

    if (filter.minSpent !== undefined || filter.maxSpent !== undefined) {
      where.totalSpent = {
        ...(filter.minSpent !== undefined ? { gte: filter.minSpent } : {}),
        ...(filter.maxSpent !== undefined ? { lte: filter.maxSpent } : {}),
      };
    }

    // "По давности депозита" (запрос пользователя) — новое Client.lastPurchaseAt.
    if (filter.lastPurchaseSince || filter.lastPurchaseUntil) {
      where.lastPurchaseAt = {
        ...(filter.lastPurchaseSince ? { gte: new Date(filter.lastPurchaseSince) } : {}),
        ...(filter.lastPurchaseUntil ? { lte: new Date(filter.lastPurchaseUntil) } : {}),
      };
    }

    if (typeof filter.isSubscribed === 'boolean') where.isSubscribed = filter.isSubscribed;

    if (filter.subscribedSince || filter.subscribedUntil) {
      where.subscribedAt = {
        ...(filter.subscribedSince ? { gte: new Date(filter.subscribedSince) } : {}),
        ...(filter.subscribedUntil ? { lte: new Date(filter.subscribedUntil) } : {}),
      };
    }

    if (filter.unsubscribedSince || filter.unsubscribedUntil) {
      where.unsubscribedAt = {
        ...(filter.unsubscribedSince ? { gte: new Date(filter.unsubscribedSince) } : {}),
        ...(filter.unsubscribedUntil ? { lte: new Date(filter.unsubscribedUntil) } : {}),
      };
    }

    if (filter.country?.length) where.country = { in: filter.country };

    if (filter.inactiveDaysMin !== undefined) {
      where.lastActiveAt = { lte: new Date(Date.now() - filter.inactiveDaysMin * 24 * 60 * 60 * 1000) };
    }

    // Папка Telegram — резолвится в явный список tgUserId ДО построения where (см.
    // TelegramPersonalService.getFolderTgUserIds — только includePeers, без правило-based
    // категорий, задокументированное ограничение). Пустой результат = ни один клиент не попадёт,
    // что и есть корректное поведение для несуществующей/пустой папки.
    if (filter.folderId !== undefined) {
      const channel = await this.getPersonalChannel(projectId);
      const tgUserIds = channel ? await this.personal.getFolderTgUserIds(channel, filter.folderId) : [];
      where.tgUserId = { in: tgUserIds };
    }

    return where;
  }

  async previewAudience(projectId: string, filter: PersonalBroadcastFilterDto): Promise<number> {
    const where = await this.buildAudienceWhere(projectId, filter);
    return this.prisma.client.count({ where });
  }

  // round-robin по вариантам (запрос пользователя: "половине аудитории один вариант а второй
  // половине второй... сколько вариантов угодно") — детерминированное равномерное распределение,
  // не случайное: проще проверить/отладить, и с большой аудиторией сходится к тому же 50/50.
  async create(projectId: string, dto: CreatePersonalBroadcastDto, userId: string): Promise<PersonalBroadcast> {
    const channel = await this.getPersonalChannel(projectId);
    if (!channel) throw new BadRequestException('К проекту не подключён личный Telegram-аккаунт');

    const where = await this.buildAudienceWhere(projectId, dto.filter);
    const matching = await this.prisma.client.findMany({ where, select: { id: true } });

    const broadcast = await this.prisma.$transaction(async (tx) => {
      const b = await tx.personalBroadcast.create({
        data: {
          projectId,
          name: dto.name,
          variants: dto.variants as unknown as Prisma.InputJsonValue,
          filter: dto.filter as unknown as Prisma.InputJsonValue,
          delayMinSeconds: dto.delayMinSeconds ?? 15,
          delayMaxSeconds: dto.delayMaxSeconds ?? 45,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          audienceTotal: matching.length,
          status: dto.scheduledAt ? PersonalBroadcastStatus.SCHEDULED : PersonalBroadcastStatus.DRAFT,
          createdById: userId,
        },
      });

      if (matching.length) {
        await tx.personalBroadcastLog.createMany({
          data: matching.map((c, i) => ({
            broadcastId: b.id,
            clientId: c.id,
            variantIndex: i % dto.variants.length,
          })),
        });
      }

      return b;
    });

    if (dto.sendNow) await this.send(broadcast.id);
    return broadcast;
  }

  // Запускается и вручную (POST .../send), и из PersonalBroadcastsCron (наступил scheduledAt,
  // или восстановление зависшего SENDING после рестарта процесса) — единая точка входа.
  async send(broadcastId: string): Promise<void> {
    const broadcast = await this.prisma.personalBroadcast.findUniqueOrThrow({
      where: { id: broadcastId },
      include: { project: { select: { companyId: true } } },
    });

    // Единая точка решения "можно ли слать" (см. CLAUDE.md choke points) — 'personal-broadcasts'
    // не совпадает ни с одним case в switch, но безусловные isSuspended/planExpiresAt проверки
    // применяются всё равно: заблокированная/просроченная компания не должна слать даже с
    // личного аккаунта, а дневной лимит именно ботовых пушей тут неприменим.
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: broadcast.project.companyId } });
    const { blocked, reason } = checkSubscriptionLimit(company, 'personal-broadcasts');
    if (blocked) throw new ForbiddenException(reason);

    // Один и тот же MTProto-сокет на канал не должен получать параллельные invoke() от двух
    // рассылок сразу (риск флуда — тот же принцип, что уже документирует StoriesCron) — вместо
    // распределённого лока просто не даём второй рассылке того же проекта стартовать, пока
    // первая не завершится.
    const alreadySending = await this.prisma.personalBroadcast.findFirst({
      where: { projectId: broadcast.projectId, status: PersonalBroadcastStatus.SENDING, id: { not: broadcastId } },
      select: { id: true },
    });
    if (alreadySending) {
      throw new ForbiddenException('Для этого проекта уже идёт другая рассылка с личного аккаунта — дождитесь её завершения');
    }

    // Атомарный claim — тот же приём, что PushesService.send/StoriesService.publish.
    const claimed = await this.prisma.personalBroadcast.updateMany({
      where: { id: broadcastId, status: { in: [PersonalBroadcastStatus.DRAFT, PersonalBroadcastStatus.SCHEDULED] } },
      data: { status: PersonalBroadcastStatus.SENDING },
    });
    if (claimed.count === 0) return;

    // Один длинный джоб на весь broadcast, не по джобу на получателя — процессор сам делает
    // паузу между отправками внутри цикла (см. personal-broadcasts.processor.ts).
    await this.queue.add('send-broadcast', { broadcastId });
  }

  // Восстановление после падения процесса (PersonalBroadcastsCron) — broadcast уже в SENDING
  // (не DRAFT/SCHEDULED, поэтому send()'а атомарный claim тут не подходит), просто ставим
  // джоб ещё раз; процессор продолжит с первой PENDING строки, ничего не задвоит.
  async requeueSending(broadcastId: string): Promise<void> {
    await this.queue.add('send-broadcast', { broadcastId });
  }

  async cancel(broadcastId: string, projectId: string): Promise<void> {
    await this.prisma.personalBroadcast.updateMany({
      where: { id: broadcastId, projectId, status: { in: ACTIVE_STATUSES } },
      data: { status: PersonalBroadcastStatus.CANCELLED },
    });
  }

  async findAll(projectId: string): Promise<PersonalBroadcast[]> {
    return this.prisma.personalBroadcast.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string, projectId: string): Promise<PersonalBroadcast> {
    const broadcast = await this.prisma.personalBroadcast.findFirst({ where: { id, projectId } });
    if (!broadcast) throw new NotFoundException('Рассылка не найдена');
    return broadcast;
  }

  async findLogs(id: string, projectId: string) {
    await this.findOne(id, projectId);
    return this.prisma.personalBroadcastLog.findMany({
      where: { broadcastId: id },
      include: { client: { select: { id: true, tgUsername: true, tgFirstName: true } } },
      orderBy: { id: 'asc' },
    });
  }
}
