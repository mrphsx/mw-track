import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsEvaluator } from './notifications-evaluator.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsCron {
  constructor(
    private evaluator: NotificationsEvaluator,
    private notifications: NotificationsService,
  ) {}

  // Каждые 5 минут: чаще, чем обновляются сами сигналы (проверка каналов — раз в 15 минут,
  // личных аккаунтов — раз в 30), поэтому задержка оповещения ограничена этими проверками, а не
  // этим кроном. Проверяются только компании с подключённым ботом — их единицы.
  @Cron('*/5 * * * *')
  async run(): Promise<void> {
    await this.evaluator.evaluateAll();
  }

  // Раз в 3 часа: сверка юзернеймов у тех, о ком больше 12 часов не было вестей (см.
  // NotificationsService.refreshStaleProfiles) — не больше двух getChat в сутки на получателя.
  @Cron('20 */3 * * *')
  async refreshProfiles(): Promise<void> {
    await this.notifications.refreshStaleProfiles();
  }
}
