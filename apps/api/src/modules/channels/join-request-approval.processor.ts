import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { GrammyError } from 'grammy';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramProvider } from './providers/telegram.provider';

export interface ApproveJoinRequestJob {
  channelId: string;
  chatId: number;
  tgUserId: number;
  // Приветствие шлём только для заявок с нашего лендинга/бота (см. TelegramProvider.
  // handleJoinRequest) — заявки по чужим invite-ссылкам одобряем с той же задержкой, но без
  // приветствия, точно как в синхронном (без задержки) пути сегодня.
  sendWelcome: boolean;
}

// Задержка одобрения заявки (Channel.tgJoinDelaySeconds) — джоба ставится в очередь из
// TelegramProvider.handleJoinRequest с { delay: seconds * 1000 } вместо синхронного
// approveChatJoinRequest внутри вебхука. Client/Subscribe-событие/пиксели уже записаны к
// этому моменту (решение согласовано с пользователем 2026-07-03 — атрибуция для рекламных
// площадок не должна плыть вместе с искусственной задержкой одобрения), здесь только сам
// approve + приветственное сообщение.
@Processor('join-request-approval')
export class JoinRequestApprovalProcessor {
  private readonly logger = new Logger(JoinRequestApprovalProcessor.name);

  constructor(
    private telegramProvider: TelegramProvider,
    private prisma: PrismaService,
  ) {}

  @Process('approve-join-request')
  async handle(job: Job<ApproveJoinRequestJob>) {
    const { channelId, chatId, tgUserId, sendWelcome } = job.data;

    const bot = this.telegramProvider.getBot(channelId);
    if (!bot) {
      this.logger.warn(`approve-join-request: нет инстанса бота для канала ${channelId} (был перезапуск?)`);
      return;
    }

    try {
      await bot.api.approveChatJoinRequest(chatId, tgUserId);
    } catch (error) {
      // USER_ALREADY_PARTICIPANT — тот же случай, что и в синхронном пути (TelegramProvider.
      // approveJoinRequestMaybeDelayed, запрос пользователя 2026-07-21): пользователь уже в
      // канале, но подписчика мы уже затрекали новым — приветствие всё равно должно уйти.
      // Любая другая ошибка (пользователь сам отозвал заявку за время задержки и т.п.) —
      // реального вступления не произошло, не ретраим и не шлём приветствие.
      if (!(error instanceof GrammyError && /USER_ALREADY_PARTICIPANT/.test(error.description))) {
        this.logger.warn(`Отложенное одобрение заявки не удалось (канал ${channelId}, user ${tgUserId}): ${(error as Error).message}`);
        return;
      }
    }

    if (!sendWelcome) return;

    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (channel) await this.telegramProvider.sendWelcomeMessage(String(tgUserId), channel);
  }
}
