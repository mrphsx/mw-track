import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Channel } from '@prisma/client';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { renderMessagePlaceholders } from '../../common/message-placeholders.util';
import { TelegramProvider } from './providers/telegram.provider';

// Тот же граф-приём и та же защита от циклов, что уже проверены в AutomationEngineService
// (apps/api/src/modules/automations/automation-engine.service.ts) — сознательно СЕСТРИНСКИЙ
// сервис, а не одна общая generic-реализация (согласовано с пользователем 2026-07-22: общий
// движок/редактор шагов, но разные таблицы) — автоворонки трогать не должны были вообще, а
// единственное реальное отличие в отправке (Client+ChannelsService у автоворонок vs
// tgUserId+channel напрямую у сценариев, см. ниже) всё равно не дало бы честно обобщить сам
// send-шаг.
const MAX_STEPS_PER_TICK = 50;

@Injectable()
export class BotScenarioEngineService {
  private readonly logger = new Logger(BotScenarioEngineService.name);

  constructor(
    private prisma: PrismaService,
    private moduleRef: ModuleRef,
    @InjectQueue('bot-scenario-steps') private queue: Queue,
  ) {}

  // TelegramProvider резолвится лениво через ModuleRef, а не конструкторной инъекцией —
  // TelegramProvider.triggerScenario вызывает этот сервис напрямую, конструкторная инъекция в
  // обе стороны замкнула бы цикл в графе DI ещё до старта приложения (тот же класс проблемы,
  // что уже не раз ловился в этом проекте — см. память про circular-DI, всегда чинится
  // ModuleRef.get(..., {strict:false}) вместо forwardRef).
  private getTelegramProvider(): TelegramProvider {
    return this.moduleRef.get(TelegramProvider, { strict: false });
  }

  // Точка входа — вызывается из TelegramProvider.triggerScenario на каждое срабатывание
  // бот-события (команда/ФД/РД/отписка/дефолт). В отличие от автоворонок — НИКАКОЙ проверки
  // "уже запускали для этого клиента" нет и не должно быть: РД обязан срабатывать заново
  // каждый раз, команда — при каждом вводе.
  async trigger(scenarioId: string, tgUserId: string, channel: Channel, clientId?: string): Promise<void> {
    const scenario = await this.prisma.botScenario.findFirst({ where: { id: scenarioId, firstStepId: { not: null } } });
    if (!scenario?.firstStepId) return;

    const run = await this.prisma.botScenarioRun.create({
      data: { scenarioId, tgUserId, clientId, currentStepId: scenario.firstStepId },
    });
    await this.advance(run.id, channel);
  }

  // channel передаётся явно на первый вызов (уже есть у вызывающего в triggerScenario), а
  // дальше при необходимости перечитывается через scenario.channelId — тот же принцип "не
  // доверяем снимку на момент постановки джобы", что и в AutomationEngineService.advance.
  async advance(runId: string, channel?: Channel): Promise<void> {
    let run = await this.prisma.botScenarioRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== 'ACTIVE' || !run.currentStepId) return;

    const resolvedChannel = channel ?? (await this.loadChannelForRun(run.scenarioId));
    if (!resolvedChannel) {
      await this.finish(run.id, 'FAILED');
      return;
    }

    for (let i = 0; i < MAX_STEPS_PER_TICK; i++) {
      const step = await this.prisma.botScenarioStep.findUnique({ where: { id: run.currentStepId! } });
      if (!step) {
        await this.finish(run.id, 'FAILED');
        return;
      }

      if (step.type === 'DELAY') {
        const nextStepId = step.onSuccessStepId;
        run = await this.prisma.botScenarioRun.update({ where: { id: run.id }, data: { currentStepId: nextStepId } });
        if (!nextStepId) {
          await this.finish(run.id, 'COMPLETED');
          return;
        }
        await this.queue.add(
          'advance',
          { runId: run.id },
          {
            delay: (step.delaySeconds || 0) * 1000,
            jobId: `${run.id}:${step.id}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 60_000 },
            removeOnComplete: true,
            removeOnFail: 50,
          },
        );
        return; // ждём — процессор вызовет advance() снова, когда джоба выстрелит
      }

      if (step.type === 'SEND_MESSAGE') {
        await this.sendStepMessage(run.tgUserId, run.clientId, resolvedChannel, step);
        run = await this.prisma.botScenarioRun.update({ where: { id: run.id }, data: { currentStepId: step.onSuccessStepId } });
      } else if (step.type === 'CONDITION') {
        const passed = await this.evaluateCondition(run.clientId, step.conditionFilter as { hasPurchase?: boolean } | null);
        const nextStepId = passed ? step.onSuccessStepId : step.onFailureStepId;
        run = await this.prisma.botScenarioRun.update({ where: { id: run.id }, data: { currentStepId: nextStepId } });
        if (!nextStepId) {
          await this.finish(run.id, passed ? 'COMPLETED' : 'EXITED');
          return;
        }
        continue;
      }

      if (!run.currentStepId) {
        await this.finish(run.id, 'COMPLETED');
        return;
      }
    }

    this.logger.error(`BotScenarioRun ${runId} exceeded ${MAX_STEPS_PER_TICK} steps in one tick — possible cycle`);
    await this.finish(runId, 'FAILED');
  }

  private async loadChannelForRun(scenarioId: string): Promise<Channel | null> {
    const scenario = await this.prisma.botScenario.findUnique({ where: { id: scenarioId }, include: { channel: true } });
    return scenario?.channel ?? null;
  }

  private async finish(runId: string, status: 'COMPLETED' | 'EXITED' | 'FAILED'): Promise<void> {
    await this.prisma.botScenarioRun.update({ where: { id: runId }, data: { status, completedAt: new Date() } });
  }

  // Отправка идёт напрямую через channelUserId+channel (TelegramProvider.sendMessage), а НЕ
  // через ChannelsService.sendMessage(client, ...), как у автоворонок — сценарии (в первую
  // очередь DEFAULT/COMMAND) обязаны уметь сработать и для человека, у которого ещё нет
  // строки Client вообще. messageMedia → mediaGroup — тот же перевод, что уже
  // PushesProcessor делает для Push.messageMedia (1 элемент = одиночное фото/видео/кружок,
  // 2-10 = альбом).
  private async sendStepMessage(
    tgUserId: string,
    clientId: string | null,
    channel: Channel,
    step: { messageText: string | null; messageMedia: unknown; buttons: unknown },
  ): Promise<void> {
    const media = step.messageMedia as { type: 'photo' | 'video' | 'video_note'; url: string }[] | null;
    const mediaGroup = media && media.length > 1 ? media.map((m) => ({ type: m.type as 'photo' | 'video', url: m.url })) : undefined;

    // Персонализация {first_name}/{last_name}/{full_name}/{username} (запрос пользователя
    // 2026-07-27) — для холодных контактов без Client (DEFAULT/COMMAND ещё до первой строки
    // Client) плейсхолдеры рендерятся в пустую строку, см. renderMessagePlaceholders. Для
    // остальных триггеров (SUBSCRIBE/FIRST_DEPOSIT/REPEAT_DEPOSIT/UNSUBSCRIBE) clientId всегда
    // есть — состояние подписки/депозита физически не бывает без строки Client.
    const client = clientId
      ? await this.prisma.client.findUnique({ where: { id: clientId }, select: { tgFirstName: true, tgLastName: true, tgUsername: true } })
      : null;
    const source = { firstName: client?.tgFirstName, lastName: client?.tgLastName, username: client?.tgUsername };
    const text = renderMessagePlaceholders(step.messageText || '', source);
    const buttons = (step.buttons as Array<{ text: string; url: string }> | null)?.map((b) => ({ ...b, text: renderMessagePlaceholders(b.text, source) }));

    try {
      await this.getTelegramProvider().sendMessage(
        tgUserId,
        {
          text,
          mediaUrl: media?.[0]?.url,
          mediaType: media?.[0]?.type,
          mediaGroup,
          buttons,
        },
        channel,
      );
    } catch (error) {
      this.logger.warn(`Scenario SEND_MESSAGE failed for tgUserId ${tgUserId}: ${(error as Error).message}`);
    }
  }

  // v1: то же единственное условие, что у автоворонок — совершил/не совершил покупку. Клиент
  // не найден (run.clientId пуст — холодный контакт без Client) — условие трактуется как
  // невыполненное (запрос пользователя, см. план), а не как "пропустить проверку".
  private async evaluateCondition(clientId: string | null, filter: { hasPurchase?: boolean } | null): Promise<boolean> {
    if (!clientId) return false;
    if (!filter || filter.hasPurchase == null) return true; // не настроено — не блокируем
    const client = await this.prisma.client.findUnique({ where: { id: clientId }, select: { hasPurchase: true } });
    return client?.hasPurchase === filter.hasPurchase;
  }
}
