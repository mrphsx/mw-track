import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramProvider } from './providers/telegram.provider';

export interface ScenarioMessageJob {
  channelId: string;
  tgUserId: string;
  scenarioId: string;
}

// Отложенная отправка сообщения сценария (BotScenario.delaySeconds > 0) — джоба ставится из
// TelegramProvider.triggerScenario вместо синхронной отправки. Сценарий/канал перечитываются
// из БД на момент срабатывания, а не берутся из полезной нагрузки джобы — если сценарий за
// время задержки выключили/удалили/отредактировали, уходит актуальная версия, а не снимок
// на момент триггера (тот же принцип, что и в JoinRequestApprovalProcessor).
@Processor('bot-scenario-message')
export class BotScenarioMessageProcessor {
  private readonly logger = new Logger(BotScenarioMessageProcessor.name);

  constructor(
    private telegramProvider: TelegramProvider,
    private prisma: PrismaService,
  ) {}

  @Process('send-scenario-message')
  async handle(job: Job<ScenarioMessageJob>) {
    const { channelId, tgUserId, scenarioId } = job.data;

    const [channel, scenario] = await Promise.all([
      this.prisma.channel.findUnique({ where: { id: channelId } }),
      this.prisma.botScenario.findFirst({ where: { id: scenarioId, deletedAt: null } }),
    ]);

    if (!channel || !scenario || !scenario.isActive) return;

    const bot = this.telegramProvider.getBot(channelId);
    if (!bot) {
      this.logger.warn(`send-scenario-message: нет инстанса бота для канала ${channelId} (был перезапуск?)`);
      return;
    }

    await this.telegramProvider.sendScenarioMessage(tgUserId, scenario, channel);
  }
}
