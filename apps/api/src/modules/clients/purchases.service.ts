import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Purchase } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    private prisma: PrismaService,
    private trackingService: TrackingService,
  ) {}

  async create(projectId: string, clientId: string, dto: CreatePurchaseDto, registeredBy?: string): Promise<Purchase> {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.purchase.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
      if (existing) return existing;
    }

    let purchase: Purchase;
    try {
      purchase = await this.prisma.$transaction(async (tx) => {
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
          },
        });

        await tx.client.update({
          where: { id: clientId },
          data: {
            hasPurchase: true,
            totalSpent: { increment: dto.amount },
            purchasesCount: { increment: 1 },
            lastActiveAt: new Date(),
          },
        });

        return p;
      });
    } catch (error) {
      // Гонка: два конкурентных запроса с одним idempotencyKey прошли проверку
      // findUnique выше одновременно — БД отклонит второй create уникальным constraint'ом
      // (P2002), и тогда нужно вернуть уже созданную запись, а не 500.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && dto.idempotencyKey) {
        const existing = await this.prisma.purchase.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
        if (existing) return existing;
      }
      throw error;
    }

    // fbclid/ttclid/email/phone берутся из карточки клиента — это и есть смысл их
    // накопления через Redis start-param bridge (1.5): без них FB/TikTok не смогут
    // сматчить покупку с рекламным кликом.
    try {
      const client = await this.prisma.client.findUnique({ where: { id: clientId } });
      await this.trackingService.recordEvent(projectId, {
        eventName: 'Purchase',
        idempotencyKey: `${projectId}_Purchase_${purchase.id}`,
        clientId,
        value: Number(dto.amount),
        currency: dto.currency || 'USD',
        orderId: dto.orderId,
        fbclid: client?.fbclid ?? undefined,
        ttclid: client?.ttclid ?? undefined,
        email: client?.email ?? undefined,
        phone: client?.phone ?? undefined,
        source: 'SERVER',
      });
    } catch (error) {
      this.logger.warn(`Failed to record Purchase tracking event for ${purchase.id}: ${(error as Error).message}`);
    }

    return purchase;
  }

  async findByClient(clientId: string): Promise<Purchase[]> {
    return this.prisma.purchase.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' } });
  }
}
