import { Body, Controller, HttpCode, Headers, Param, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { NotificationsService } from './notifications.service';

// Отдельно от WebhooksController (там вебхуки ботов КАНАЛОВ через TelegramProvider) — этот бот
// живёт своей жизнью и проверяет X-Telegram-Bot-Api-Secret-Token, которого у ботов каналов нет.
@Controller('webhooks/notifier')
export class NotificationWebhookController {
  constructor(private notifications: NotificationsService) {}

  @Public()
  @Post(':id')
  @HttpCode(200)
  async handle(
    @Param('id') id: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: object,
  ) {
    await this.notifications.handleUpdate(id, secret, update);
    return { ok: true };
  }
}
