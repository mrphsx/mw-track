import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { EncryptionService } from '../../common/encryption.service';
import { NotificationWebhookController } from './notification-webhook.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsCron } from './notifications.cron';
import { NOTIFICATION_MESSAGES_QUEUE, NotificationsEvaluator } from './notifications-evaluator.service';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: NOTIFICATION_MESSAGES_QUEUE,
      // Ниже лимита Telegram в 30 сообщений/сек на бота — с запасом.
      limiter: { max: 20, duration: 1000 },
    }),
  ],
  controllers: [NotificationsController, NotificationWebhookController],
  // EncryptionService — отдельный экземпляр, как в ChannelsModule: он без состояния, кроме ключа из env.
  providers: [NotificationsService, NotificationsEvaluator, NotificationsProcessor, NotificationsCron, EncryptionService],
})
export class NotificationsModule {}
