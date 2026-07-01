import { InjectQueue } from '@nestjs/bull';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Push, PushStatus } from '@prisma/client';
import { Queue } from 'bull';
import { subDays } from 'date-fns';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientsService } from '../clients/clients.service';
import { PushFilterDto } from '../clients/dto/push-filter.dto';
import { CreatePushDto } from './dto/create-push.dto';
import { UpdatePushDto } from './dto/update-push.dto';

const EDITABLE_STATUSES: PushStatus[] = [PushStatus.DRAFT, PushStatus.SCHEDULED];

@Injectable()
export class PushesService {
  constructor(
    private prisma: PrismaService,
    private clientsService: ClientsService,
    @InjectQueue('push-messages') private pushQueue: Queue,
  ) {}

  private async previewAudience(projectId: string, filter: PushFilterDto) {
    const [audienceTotal, audienceReachable] = await Promise.all([
      this.clientsService.countAudienceTotal(projectId, filter),
      this.clientsService.countPushAudience(projectId, filter),
    ]);
    return { audienceTotal, audienceReachable };
  }

  async create(projectId: string, dto: CreatePushDto): Promise<Push> {
    const { audienceTotal, audienceReachable } = await this.previewAudience(projectId, dto.filter);

    return this.prisma.push.create({
      data: {
        projectId,
        name: dto.name,
        messageText: dto.messageText,
        messageMedia: (dto.messageMedia as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        buttons: (dto.buttons as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        filter: dto.filter as unknown as Prisma.InputJsonValue,
        audienceTotal,
        audienceReachable,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        status: dto.scheduledAt ? PushStatus.SCHEDULED : PushStatus.DRAFT,
      },
    });
  }

  async findAll(projectId: string): Promise<Push[]> {
    return this.prisma.push.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string, projectId: string): Promise<Push> {
    const push = await this.prisma.push.findFirst({ where: { id, projectId } });
    if (!push) throw new NotFoundException('Пуш не найден');
    return push;
  }

  async update(id: string, projectId: string, dto: UpdatePushDto): Promise<Push> {
    const push = await this.findOne(id, projectId);
    this.assertEditable(push);

    const filterChanged = !!dto.filter;
    const recalculated = filterChanged ? await this.previewAudience(projectId, dto.filter!) : {};

    return this.prisma.push.update({
      where: { id },
      data: {
        name: dto.name,
        messageText: dto.messageText,
        messageMedia: dto.messageMedia !== undefined ? (dto.messageMedia as unknown as Prisma.InputJsonValue) : undefined,
        buttons: dto.buttons !== undefined ? (dto.buttons as unknown as Prisma.InputJsonValue) : undefined,
        filter: filterChanged ? (dto.filter as unknown as Prisma.InputJsonValue) : undefined,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        ...recalculated,
      },
    });
  }

  // Пересчёт по уже сохранённому фильтру — состав клиентов мог измениться
  // (новые подписчики, кто-то заблокировал бота) с момента создания черновика
  async recalculateAudience(id: string, projectId: string): Promise<Push> {
    const push = await this.findOne(id, projectId);
    this.assertEditable(push);

    const { audienceTotal, audienceReachable } = await this.previewAudience(
      projectId,
      push.filter as unknown as PushFilterDto,
    );
    return this.prisma.push.update({ where: { id }, data: { audienceTotal, audienceReachable } });
  }

  // Лимит "сколько пушей в месяц" проверен @SubscriptionLimit('pushes') на контроллере
  // ДО вызова этого метода — здесь только инкремент счётчика использования.
  async send(id: string, projectId: string, companyId: string): Promise<Push> {
    const push = await this.findOne(id, projectId);
    this.assertEditable(push);

    const updated = await this.prisma.push.update({
      where: { id },
      data: { status: PushStatus.SENDING, sentAt: new Date() },
    });

    await this.prisma.company.update({
      where: { id: companyId },
      data: { pushesThisMonth: { increment: 1 } },
    });

    // Аудитория с нулевым размером — сразу SENT, иначе процессор никогда не увидит
    // sentCount+failedCount >= audienceReachable (0 >= 0 уже true, но джобов не будет,
    // которые могли бы это проверить)
    if (updated.audienceReachable === 0) {
      return this.prisma.push.update({ where: { id }, data: { status: PushStatus.SENT } });
    }

    for await (const chunk of this.clientsService.getClientsForPushInChunks(
      projectId,
      push.filter as unknown as PushFilterDto,
    )) {
      for (const client of chunk) {
        await this.pushQueue.add('send-push-message', { pushId: id, clientId: client.id });
      }
    }

    return updated;
  }

  async cancel(id: string, projectId: string): Promise<Push> {
    const push = await this.findOne(id, projectId);
    this.assertEditable(push);
    return this.prisma.push.update({ where: { id }, data: { status: PushStatus.FAILED } });
  }

  async findLogs(id: string, projectId: string, page = 1, limit = 50) {
    await this.findOne(id, projectId);

    const [items, total] = await Promise.all([
      this.prisma.pushLog.findMany({
        where: { pushId: id },
        include: { client: { select: { id: true, tgUsername: true, tgFirstName: true } } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.pushLog.count({ where: { pushId: id } }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // Раз в сутки, не на каждую компанию по отдельному таймеру — "скользящие 30 дней
  // от последнего сброса", не календарный месяц: проще и без эффектов часового пояса
  async resetMonthlyPushLimits(): Promise<void> {
    const companies = await this.prisma.company.findMany({
      where: { pushesResetAt: { lte: subDays(new Date(), 30) } },
    });

    for (const company of companies) {
      await this.prisma.company.update({
        where: { id: company.id },
        data: { pushesThisMonth: 0, pushesResetAt: new Date() },
      });
    }
  }

  private assertEditable(push: Push) {
    if (!EDITABLE_STATUSES.includes(push.status)) {
      throw new ForbiddenException('Пуш уже отправляется или отправлен');
    }
  }
}
