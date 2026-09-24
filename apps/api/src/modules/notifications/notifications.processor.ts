import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { EncryptionService } from '../../common/encryption.service';
import { PrismaService } from '../../prisma/prisma.service';
import { classifyTelegramError, describeTelegramError, sendNotifierMessage } from './notification-telegram';
import { NOTIFICATION_MESSAGES_QUEUE, NotificationJob } from './notifications-evaluator.service';
import { NotificationsService } from './notifications.service';

@Processor(NOTIFICATION_MESSAGES_QUEUE)
export class NotificationsProcessor {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private notifications: NotificationsService,
  ) {}

  @Process('send')
  async send(job: Job<NotificationJob>): Promise<void> {
    const recipient = await this.prisma.notificationRecipient.findUnique({
      where: { id: job.data.recipientId },
      include: { notificationBot: true },
    });
    // Между постановкой в очередь и отправкой получателя могли удалить, отписать (/stop) или
    // отключить весь бот — тогда молча пропускаем.
    if (!recipient?.chatId || !recipient.notificationBot.isActive) return;

    try {
      const profile = await sendNotifierMessage(
        this.encryption.decrypt(recipient.notificationBot.tokenEncrypted),
        recipient.chatId,
        job.data.text,
      );
      if (recipient.lastError) {
        await this.prisma.notificationRecipient.update({ where: { id: recipient.id }, data: { lastError: null } });
      }
      // Ответ Telegram уже содержит текущий юзернейм — сверяем без лишнего запроса.
      if (profile) await this.notifications.syncProfile(recipient.id, profile);
    } catch (error) {
      const kind = classifyTelegramError(error);
      this.logger.warn(
        `Оповещение для ${this.notifications.recipientLabel(recipient)} не доставлено (${kind}): ${describeTelegramError(error)}`,
      );
      // Повторять имеет смысл только сетевые/временные ошибки; блокировка бота или отозванный
      // токен не исправятся сами — фиксируем и видим это в настройках.
      if (kind === 'RETRYABLE' && job.attemptsMade + 1 < (job.opts.attempts ?? 1)) throw error;
      await this.notifications.recordDeliveryFailure(recipient.notificationBot.id, recipient.id, kind, error);
    }
  }
}
