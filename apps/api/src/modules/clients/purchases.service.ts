import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma, Purchase } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { ChannelsService } from '../channels/channels.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    private prisma: PrismaService,
    private trackingService: TrackingService,
    private moduleRef: ModuleRef,
  ) {}

  // ChannelsService резолвится лениво через ModuleRef, а не конструкторной инъекцией —
  // прямая инъекция закольцовывает граф на бутстрапе: ChannelsService создаёт
  // TelegramProvider, который сам инжектит PurchasesService. Даже с forwardRef на этом ребре
  // Nest реально ЗАВИСАЛ на старте (не ошибка — именно бесконечное ожидание, подтверждено
  // живым инцидентом: процесс не долистал InstanceLoader дальше BillingModule, порт не
  // слушался, api.mw-track.com отдавал 502). ModuleRef.get(..., { strict: false }) достаёт
  // уже полностью поднятый инстанс из общего контейнера ПОСЛЕ старта приложения — не участвует
  // в графе конструкторной инъекции вообще, цикла не возникает в принципе. Импорт класса тут
  // (в отличие от инъекции) не создаёт цикл сам по себе — channels.service.ts не импортирует
  // purchases.service.ts обратно (только telegram.provider.ts, другой файл).
  private getChannelsService(): ChannelsService {
    return this.moduleRef.get(ChannelsService, { strict: false });
  }

  async create(projectId: string, clientId: string, dto: CreatePurchaseDto, registeredBy?: string): Promise<Purchase> {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.purchase.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
      if (existing) return existing;
    }

    // До инкремента — единственный момент, когда можно узнать "это первый депозит или
    // повторный" (см. вызов channelsService.triggerScenario в конце метода). Тот же fetch
    // переиспользуется ниже для fbclid/ttclid-атрибуции Purchase-события — раньше был
    // отдельный повторный запрос после транзакции, теперь один на весь метод.
    const clientBefore = await this.prisma.client.findUnique({ where: { id: clientId } });

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
      // forceSend: true — этот метод сейчас единственная точка регистрации покупки (webhook от
      // платёжных систем отменён, см. 15_PHASES.md §3.5), т.е. по сути всегда ручное действие
      // сотрудника ("Добавить покупку" в списке клиентов) — выключенный свитч "Покупка" (запрос
      // пользователя 2026-07-27) не должен блокировать именно эту, единственную сегодня, точку
      // входа. Когда появится автоматическая регистрация депозитов (см. память про планируемый
      // модуль Deposits), она должна звать recordEvent БЕЗ forceSend, чтобы свитч на неё влиял.
      await this.trackingService.recordEvent(projectId, {
        eventName: 'Purchase',
        idempotencyKey: `${projectId}_Purchase_${purchase.id}`,
        clientId,
        value: Number(dto.amount),
        currency: dto.currency || 'USD',
        orderId: dto.orderId,
        fbclid: clientBefore?.fbclid ?? undefined,
        ttclid: clientBefore?.ttclid ?? undefined,
        email: clientBefore?.email ?? undefined,
        phone: clientBefore?.phone ?? undefined,
        source: 'SERVER',
        forceSend: true,
      });
    } catch (error) {
      this.logger.warn(`Failed to record Purchase tracking event for ${purchase.id}: ${(error as Error).message}`);
    }

    // Сценарий бота (первый/повторный депозит) — см. bot-scenarios. Единственная точка
    // вызова, намеренно (см. память про будущий модуль депозитов — когда регистрация
    // депозита переедет в отдельный DepositsService/через бота-пересыльщик, этот один вызов
    // просто переедет вместе с ней, сама система сценариев не меняется). Не должен ронять
    // уже успешно созданную покупку, если отправка сообщения по какой-то причине упадёт.
    try {
      if (clientBefore) {
        const isFirstDeposit = clientBefore.purchasesCount === 0;
        await this.getChannelsService().triggerScenario(clientBefore, isFirstDeposit ? 'FIRST_DEPOSIT' : 'REPEAT_DEPOSIT');
      }
    } catch (error) {
      this.logger.warn(`Failed to trigger deposit bot scenario for purchase ${purchase.id}: ${(error as Error).message}`);
    }

    return purchase;
  }

  async findByClient(clientId: string): Promise<Purchase[]> {
    return this.prisma.purchase.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' } });
  }
}
