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
    // Прогрев кеша диалогов не блокирует этот ответ (см. TelegramPersonalService.prewarmDialogsCache)
    // — к моменту, когда пользователь дойдёт до фильтров, холодный фетch для больших аккаунтов
    // уже будет в процессе вместо стартующего только на первый preview-audience.
    this.personal.prewarmDialogsCache(channel);
    return this.personal.getDialogFilters(channel);
  }

  // ПЕРЕРАБОТАНО 2026-08-06 (запрос пользователя: "чтобы можно было пушить не только клиентов
  // пришедших через нашу срм, но и всех остальных, даже внешних, все абсолютно чаты должны
  // пушиться, неважно откуда они") — раньше аудитория была ЦЕЛИКОМ запросом к Client
  // (dialogueSource='PERSONAL_ACCOUNT'), т.е. только тем, кого CRM уже успела создать как
  // клиента. Источником правды теперь служит ЖИВОЙ список диалогов Telegram-аккаунта
  // (TelegramPersonalService.getAllDialogs) — включает вообще всех, с кем есть 1:1 диалог,
  // независимо от того, создавала ли CRM для них Client. Данные CRM (покупки/подписка/страна и
  // т.д.) накладываются ПОВЕРХ этого списка там, где для tgUserId нашлась строка Client — для
  // диалогов без Client все CRM-поля трактуются как отсутствующие/нулевые (тот же смысл, что и
  // LEFT JOIN с NULL-строкой): фильтр "hasPurchase: true" их закономерно исключит (у них
  // действительно 0 покупок), а "hasPurchase: false" — включит, что и есть корректное поведение,
  // не специальный случай.
  private async resolveAudience(
    projectId: string,
    channel: Channel,
    filter: PersonalBroadcastFilterDto,
  ): Promise<{ tgUserId: string; clientId?: string; firstName?: string; username?: string }[]> {
    let dialogs = await this.personal.getAllDialogs(channel);
    if (dialogs.length === 0) return [];

    // Папка Telegram — сужаем список ДО похода в Client, экономим запрос при пустой папке.
    if (filter.folderId !== undefined) {
      const folderTgUserIds = new Set(await this.personal.getFolderTgUserIds(channel, filter.folderId));
      dialogs = dialogs.filter((d) => folderTgUserIds.has(d.tgUserId));
      if (dialogs.length === 0) return [];
    }

    const clients = await this.prisma.client.findMany({
      where: { projectId, deletedAt: null, tgUserId: { in: dialogs.map((d) => d.tgUserId) } },
      select: {
        id: true,
        tgUserId: true,
        lastDialogueAt: true,
        hasPurchase: true,
        purchasesCount: true,
        totalSpent: true,
        lastPurchaseAt: true,
        isSubscribed: true,
        subscribedAt: true,
        unsubscribedAt: true,
        country: true,
        lastActiveAt: true,
      },
    });
    const clientByTgUserId = new Map(clients.map((c) => [c.tgUserId!, c]));

    const dialogueSince = filter.dialogueSince ? new Date(filter.dialogueSince) : undefined;
    const dialogueUntil = filter.dialogueUntil ? new Date(filter.dialogueUntil) : undefined;
    const lastPurchaseSince = filter.lastPurchaseSince ? new Date(filter.lastPurchaseSince) : undefined;
    const lastPurchaseUntil = filter.lastPurchaseUntil ? new Date(filter.lastPurchaseUntil) : undefined;
    const subscribedSince = filter.subscribedSince ? new Date(filter.subscribedSince) : undefined;
    const subscribedUntil = filter.subscribedUntil ? new Date(filter.subscribedUntil) : undefined;
    const unsubscribedSince = filter.unsubscribedSince ? new Date(filter.unsubscribedSince) : undefined;
    const unsubscribedUntil = filter.unsubscribedUntil ? new Date(filter.unsubscribedUntil) : undefined;
    const inactiveBefore = filter.inactiveDaysMin !== undefined ? new Date(Date.now() - filter.inactiveDaysMin * 24 * 60 * 60 * 1000) : undefined;

    const result: { tgUserId: string; clientId?: string; firstName?: string; username?: string }[] = [];
    for (const dialog of dialogs) {
      const client = clientByTgUserId.get(dialog.tgUserId);

      // Давность диалога — для трекнутых клиентов берём Client.lastDialogueAt (наш собственный
      // сигнал), для остальных — дату последнего сообщения в самом диалоге по данным Telegram
      // (TelegramPersonalService.getAllDialogs.lastMessageAt) как честный эквивалент.
      const lastDialogueAt = client?.lastDialogueAt ?? dialog.lastMessageAt;
      if (dialogueSince && (!lastDialogueAt || lastDialogueAt < dialogueSince)) continue;
      if (dialogueUntil && (!lastDialogueAt || lastDialogueAt > dialogueUntil)) continue;

      if (typeof filter.hasPurchase === 'boolean' && (client?.hasPurchase ?? false) !== filter.hasPurchase) continue;
      if (filter.minPurchasesCount !== undefined && (client?.purchasesCount ?? 0) < filter.minPurchasesCount) continue;
      if (filter.maxPurchasesCount !== undefined && (client?.purchasesCount ?? 0) > filter.maxPurchasesCount) continue;
      const totalSpent = client?.totalSpent ? Number(client.totalSpent) : 0;
      if (filter.minSpent !== undefined && totalSpent < filter.minSpent) continue;
      if (filter.maxSpent !== undefined && totalSpent > filter.maxSpent) continue;

      if (lastPurchaseSince && (!client?.lastPurchaseAt || client.lastPurchaseAt < lastPurchaseSince)) continue;
      if (lastPurchaseUntil && (!client?.lastPurchaseAt || client.lastPurchaseAt > lastPurchaseUntil)) continue;

      if (typeof filter.isSubscribed === 'boolean' && (client?.isSubscribed ?? false) !== filter.isSubscribed) continue;
      if (subscribedSince && (!client?.subscribedAt || client.subscribedAt < subscribedSince)) continue;
      if (subscribedUntil && (!client?.subscribedAt || client.subscribedAt > subscribedUntil)) continue;
      if (unsubscribedSince && (!client?.unsubscribedAt || client.unsubscribedAt < unsubscribedSince)) continue;
      if (unsubscribedUntil && (!client?.unsubscribedAt || client.unsubscribedAt > unsubscribedUntil)) continue;

      if (filter.country?.length && (!client?.country || !filter.country.includes(client.country))) continue;

      // Неактивность — без Client-строки нет lastActiveAt вообще; используем дату последнего
      // сообщения в диалоге как единственный доступный признак активности внешнего контакта.
      if (inactiveBefore) {
        const lastActive = client?.lastActiveAt ?? dialog.lastMessageAt;
        if (lastActive && lastActive > inactiveBefore) continue;
      }

      result.push({ tgUserId: dialog.tgUserId, clientId: client?.id, firstName: dialog.firstName, username: dialog.username });
    }
    return result;
  }

  async previewAudience(projectId: string, filter: PersonalBroadcastFilterDto): Promise<number> {
    const channel = await this.getPersonalChannel(projectId);
    if (!channel) return 0;
    return (await this.resolveAudience(projectId, channel, filter)).length;
  }

  // round-robin по вариантам (запрос пользователя: "половине аудитории один вариант а второй
  // половине второй... сколько вариантов угодно") — детерминированное равномерное распределение,
  // не случайное: проще проверить/отладить, и с большой аудиторией сходится к тому же 50/50.
  async create(projectId: string, dto: CreatePersonalBroadcastDto, userId: string): Promise<PersonalBroadcast> {
    const channel = await this.getPersonalChannel(projectId);
    if (!channel) throw new BadRequestException('К проекту не подключён личный Telegram-аккаунт');

    const matching = await this.resolveAudience(projectId, channel, dto.filter);

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
          data: matching.map((m, i) => ({
            broadcastId: b.id,
            clientId: m.clientId,
            tgUserId: m.tgUserId,
            tgFirstName: m.firstName,
            tgUsername: m.username,
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
