import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bull';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackEventDto } from './dto/track-event.dto';

export interface RecordEventDto extends TrackEventDto {
  // Заполняются сервером, не приходят от вызывающего напрямую (см. TrackingController)
  ipAddress?: string;
  userAgent?: string;
  source?: 'BROWSER' | 'SERVER' | 'SDK';
  // Внутренние вызовы (TelegramProvider, PurchasesService) уже знают clientId —
  // передают его явно, чтобы не делать лишний resolveClient() запрос по tgUserId/fbclid
  clientId?: string;
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('tracking-events') private trackingQueue: Queue,
  ) {}

  async recordEvent(projectId: string, dto: RecordEventDto): Promise<{ eventId: string }> {
    const eventId = dto.idempotencyKey || `${projectId}_${dto.eventName}_${dto.fbclid || ''}_${Date.now()}_${nanoid(8)}`;

    const existing = await this.prisma.trackingEvent.findUnique({ where: { eventId } });
    if (existing) return { eventId };

    let clientId = dto.clientId;
    if (!clientId && (dto.tgUserId || dto.fbclid)) {
      const client = await this.resolveClient(projectId, dto);
      clientId = client?.id;
    }

    let event;
    try {
      event = await this.prisma.trackingEvent.create({
        data: {
          projectId,
          clientId,
          eventName: dto.eventName,
          eventId,
          eventTime: dto.timestamp ? new Date(dto.timestamp) : new Date(),
          source: dto.source || 'SERVER',
          payload: {
            fbclid: dto.fbclid,
            ttclid: dto.ttclid,
            email: dto.email,
            phone: dto.phone,
            ipAddress: dto.ipAddress,
            userAgent: dto.userAgent,
            pageUrl: dto.pageUrl,
            value: dto.value,
            currency: dto.currency,
            orderId: dto.orderId,
            utmSource: dto.utmSource,
            utmCampaign: dto.utmCampaign,
          },
        },
      });
    } catch (error) {
      // Гонка: два конкурентных запроса с одним eventId прошли findUnique одновременно
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { eventId };
      }
      throw error;
    }

    await this.trackingQueue.add(
      'send-to-platforms',
      { eventDbId: event.id, projectId },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        priority: dto.eventName === 'Purchase' ? 1 : 3,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );

    return { eventId };
  }

  private async resolveClient(projectId: string, dto: RecordEventDto) {
    if (dto.tgUserId) {
      return this.prisma.client.findFirst({ where: { projectId, tgUserId: dto.tgUserId } });
    }
    if (dto.fbclid) {
      return this.prisma.client.findFirst({ where: { projectId, fbclid: dto.fbclid } });
    }
    return null;
  }
}
