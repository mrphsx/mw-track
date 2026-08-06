import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { checkSubscriptionLimit } from '../../common/guards/subscription.util';
import { ChannelsService } from '../channels/channels.service';

// Максимум шагов без задержки, которые advance() пройдёт за один вызов — защита от
// зацикливания графа (в v1 UI граф строго линеен и ацикличен по построению, но сам движок не
// должен полагаться только на это — см. контекст плана).
const MAX_STEPS_PER_TICK = 50;

@Injectable()
export class AutomationEngineService {
  private readonly logger = new Logger(AutomationEngineService.name);

  constructor(
    private prisma: PrismaService,
    private moduleRef: ModuleRef,
    @InjectQueue('automation-steps') private queue: Queue,
  ) {}

  // ChannelsService резолвится лениво через ModuleRef, а не конструкторной инъекцией — тот же
  // приём и по той же причине, что уже применён в PurchasesService (см. apps/api/src/modules/
  // clients/purchases.service.ts): AutomationsModule вызывается ИЗ TrackingModule
  // (TrackingService.recordEvent → handleTriggerEvent), а ChannelsModule сам импортирует
  // TrackingModule — прямой импорт ChannelsModule здесь замкнул бы Tracking→Automations→
  // Channels→Tracking в графе NestJS-модулей. ModuleRef.get(..., {strict:false}) достаёт уже
  // поднятый инстанс из общего контейнера после старта приложения, минуя граф конструкторной
  // инъекции целиком.
  private getChannelsService(): ChannelsService {
    return this.moduleRef.get(ChannelsService, { strict: false });
  }

  // Точка входа — вызывается из TrackingService.recordEvent() на каждое записанное событие
  // (Subscribe/Purchase/Dialogue). Один клиент проходит конкретную воронку не больше раза
  // (уникальный индекс flowId+clientId) — P2002 при гонке/повторном триггере тихо игнорируется.
  async handleTriggerEvent(projectId: string, eventName: string, clientId: string): Promise<void> {
    const flows = await this.prisma.automationFlow.findMany({
      where: { projectId, triggerEvent: eventName, isActive: true, deletedAt: null, firstStepId: { not: null } },
    });

    for (const flow of flows) {
      try {
        const enrollment = await this.prisma.automationEnrollment.create({
          data: { flowId: flow.id, projectId, clientId, currentStepId: flow.firstStepId },
        });
        await this.advance(enrollment.id);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue; // уже enrolled
        this.logger.error(`handleTriggerEvent failed for flow ${flow.id}, client ${clientId}: ${(error as Error).message}`);
      }
    }
  }

  // Продвигает enrollment по цепочке шагов, пока не упрётся в DELAY (ставит отложенную джобу
  // и возвращается) или в конец графа (null next — COMPLETED/EXITED). Перечитывает состояние
  // из БД на каждом вызове — тот же принцип, что в bot-scenario-message.processor.ts: не
  // доверяем тому, что было на момент постановки джобы, а не текущему состоянию в БД.
  async advance(enrollmentId: string): Promise<void> {
    let enrollment = await this.prisma.automationEnrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment || enrollment.status !== 'ACTIVE' || !enrollment.currentStepId) return;

    for (let i = 0; i < MAX_STEPS_PER_TICK; i++) {
      const step = await this.prisma.automationStep.findUnique({ where: { id: enrollment.currentStepId! } });
      if (!step) {
        await this.finish(enrollment.id, 'FAILED');
        return;
      }

      if (step.type === 'DELAY') {
        const nextStepId = step.onSuccessStepId;
        enrollment = await this.prisma.automationEnrollment.update({
          where: { id: enrollment.id },
          data: { currentStepId: nextStepId },
        });
        if (!nextStepId) {
          await this.finish(enrollment.id, 'COMPLETED');
          return;
        }
        await this.queue.add(
          'advance',
          { enrollmentId: enrollment.id },
          {
            delay: (step.delaySeconds || 0) * 1000,
            jobId: `${enrollment.id}:${step.id}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 60_000 },
            removeOnComplete: true,
            removeOnFail: 50,
          },
        );
        return; // ждём — процессор вызовет advance() снова, когда джоба выстрелит
      }

      if (step.type === 'SEND_PUSH') {
        await this.sendStepMessage(enrollment.clientId, step.messageText || '', step.buttons as Array<{ text: string; url: string }> | null);
        enrollment = await this.prisma.automationEnrollment.update({
          where: { id: enrollment.id },
          data: { currentStepId: step.onSuccessStepId },
        });
      } else if (step.type === 'CONDITION') {
        const passed = await this.evaluateCondition(enrollment.clientId, step.conditionFilter as { hasPurchase?: boolean } | null);
        const nextStepId = passed ? step.onSuccessStepId : step.onFailureStepId;
        enrollment = await this.prisma.automationEnrollment.update({
          where: { id: enrollment.id },
          data: { currentStepId: nextStepId },
        });
        if (!nextStepId) {
          await this.finish(enrollment.id, passed ? 'COMPLETED' : 'EXITED');
          return;
        }
        continue;
      }

      if (!enrollment.currentStepId) {
        await this.finish(enrollment.id, 'COMPLETED');
        return;
      }
    }

    // Прошли MAX_STEPS_PER_TICK шагов без остановки — почти наверняка цикл в графе.
    this.logger.error(`AutomationEnrollment ${enrollmentId} exceeded ${MAX_STEPS_PER_TICK} steps in one tick — possible cycle`);
    await this.finish(enrollmentId, 'FAILED');
  }

  private async finish(enrollmentId: string, status: 'COMPLETED' | 'EXITED' | 'FAILED'): Promise<void> {
    await this.prisma.automationEnrollment.update({
      where: { id: enrollmentId },
      data: { status, completedAt: new Date() },
    });
  }

  // checkSubscriptionLimit — единая точка "можно ли этой компании слать пуши" (см. CLAUDE.md
  // choke-point), раньше проверялась только на ручной/отложенной отправке (SubscriptionGuard/
  // PushesCron) — заблокированная/приостановленная супер-админом компания всё равно могла
  // получать рассылки через автоворонки в обход этой проверки (найдено при аудите панели
  // администратора 2026-07-30, подтверждено пользователем как реальный пробел, не только
  // отложенная фича). Пропускаем шаг тихо (лог + return), не бросаем ошибку — воронка не должна
  // упасть целиком из-за временной блокировки компании, следующий клиент проверится заново.
  private async sendStepMessage(clientId: string, text: string, buttons: Array<{ text: string; url: string }> | null): Promise<void> {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return;

    const company = await this.prisma.company.findUnique({ where: { id: client.companyId } });
    if (company) {
      const { blocked, reason } = checkSubscriptionLimit(company, 'pushes');
      if (blocked) {
        this.logger.warn(`Automation SEND_PUSH skipped for client ${clientId}: ${reason}`);
        return;
      }
    }

    try {
      await this.getChannelsService().sendMessage(client, { text, buttons: buttons || undefined });
    } catch (error) {
      this.logger.warn(`Automation SEND_PUSH failed for client ${clientId}: ${(error as Error).message}`);
    }
  }

  // v1: единственное условие — совершил/не совершил покупку (см. AutomationConditionFilterDto).
  private async evaluateCondition(clientId: string, filter: { hasPurchase?: boolean } | null): Promise<boolean> {
    if (!filter || filter.hasPurchase == null) return true; // не настроено — не блокируем
    const client = await this.prisma.client.findUnique({ where: { id: clientId }, select: { hasPurchase: true } });
    return client?.hasPurchase === filter.hasPurchase;
  }
}
