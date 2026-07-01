import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '@prisma/client';
import { ClientsService } from '../../clients/clients.service';
import { TrackingService } from '../../tracking/tracking.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChannelProvider, SendMessageOptions, UserStatus } from './channel.provider.interface';

// WhatsApp Business API через 360dialog (BSP) — см. 00_MASTER_OVERVIEW.md "Provider: WhatsApp
// Cloud API (Meta) через 360dialog". Эндпоинты/заголовки/формат вебхука сверены по
// docs.360dialog.com на 2026-06-27 (POST /messages с D360-API-KEY, POST /v1/configs/webhook
// для регистрации, Basic Auth как единственный механизм проверки подлинности вебхука — у
// 360dialog нет HMAC-подписи как у Meta при прямом подключении).
@Injectable()
export class WhatsAppProvider implements ChannelProvider {
  private readonly logger = new Logger(WhatsAppProvider.name);
  private readonly baseUrl = 'https://waba-v2.360dialog.io';

  constructor(
    private prisma: PrismaService,
    private clientsService: ClientsService,
    private trackingService: TrackingService,
    private config: ConfigService,
  ) {}

  async initialize(channel: Channel): Promise<void> {
    if (!channel.wa360Token) throw new Error('360dialog API key (wa360Token) required');

    // Basic Auth для вебхука генерируем сами при первой инициализации — это не финансовый
    // секрет и не приватный ключ, просто наш собственный токен для проверки входящих
    // запросов (аналог publicToken/secretKey у Project), сохраняется один раз и переиспользуется.
    let username = channel.waWebhookUsername;
    let password = channel.waWebhookPassword;
    if (!username || !password) {
      username = crypto.randomBytes(8).toString('hex');
      password = crypto.randomBytes(16).toString('hex');
      await this.prisma.channel.update({
        where: { id: channel.id },
        data: { waWebhookUsername: username, waWebhookPassword: password },
      });
    }

    const webhookUrl = `${this.config.get<string>('API_URL')}/api/v1/webhooks/whatsapp/${channel.id}`;
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

    const res = await fetch(`${this.baseUrl}/v1/configs/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'D360-API-KEY': channel.wa360Token },
      body: JSON.stringify({ url: webhookUrl, headers: { Authorization: `Basic ${basicAuth}` } }),
    });

    if (!res.ok) {
      throw new Error(`360dialog отказал в регистрации вебхука: ${res.status} ${await res.text()}`);
    }
  }

  async sendMessage(channelUserId: string, options: SendMessageOptions, channel: Channel): Promise<boolean> {
    if (!channel.wa360Token) {
      this.logger.warn(`sendMessage: no wa360Token for channel ${channel.id}`);
      return false;
    }

    try {
      const payload = this.buildMessagePayload(channelUserId, options);

      const res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'D360-API-KEY': channel.wa360Token },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        this.logger.error(`WhatsApp sendMessage failed for channel ${channel.id}: ${res.status} ${await res.text()}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`WhatsApp sendMessage error for channel ${channel.id}: ${(error as Error).message}`);
      return false;
    }
  }

  private buildMessagePayload(to: string, options: SendMessageOptions): Record<string, unknown> {
    if (options.buttons && options.buttons.length > 0) {
      return {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: options.text },
          action: {
            buttons: options.buttons.slice(0, 3).map((b, i) => ({
              type: 'reply',
              reply: { id: `btn_${i}`, title: b.text.slice(0, 20) },
            })),
          },
        },
      };
    }

    if (options.mediaUrl) {
      const waType = options.mediaType === 'photo' ? 'image' : options.mediaType === 'video' ? 'video' : 'document';
      return {
        messaging_product: 'whatsapp',
        to,
        type: waType,
        [waType]: { link: options.mediaUrl, caption: options.text },
      };
    }

    return {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: options.text, preview_url: true },
    };
  }

  async getUserStatus(_channelUserId: string): Promise<UserStatus> {
    // 360dialog/WhatsApp Cloud API не даёт простой проверки "доступен ли пользователь" —
    // как и в TelegramProvider, "доступен по умолчанию" достаточно для текущей фазы.
    return { isReachable: true, isSubscribed: true };
  }

  // Basic Auth — единственная проверка подлинности вебхука у 360dialog (нет HMAC-подписи).
  private verifyBasicAuth(channel: Channel, authHeader: string | undefined): boolean {
    if (!channel.waWebhookUsername || !channel.waWebhookPassword) return false;
    if (!authHeader?.startsWith('Basic ')) return false;
    const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf-8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) return false;
    const user = decoded.slice(0, separatorIndex);
    const pass = decoded.slice(separatorIndex + 1);
    return user === channel.waWebhookUsername && pass === channel.waWebhookPassword;
  }

  // Вызывается из WebhooksController. payload — конверт Meta Cloud API
  // (entry[].changes[].value.messages[]), который 360dialog проксирует как есть.
  async handleWebhook(channelId: string, authHeader: string | undefined, payload: any): Promise<void> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel || channel.type !== 'WHATSAPP' || !channel.isActive) return;

    if (!this.verifyBasicAuth(channel, authHeader)) {
      this.logger.warn(`handleWebhook: invalid Basic Auth for channel ${channelId}`);
      return;
    }

    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    // Без messages — это статус-уведомление о доставке (sent/delivered/read), не входящее сообщение.
    if (!message) return;

    const phone: string = message.from;
    const waName: string | undefined = value.contacts?.[0]?.profile?.name;

    const client = await this.clientsService.findOrCreate({
      projectId: channel.projectId,
      waPhone: phone,
      waName,
      channelType: 'WHATSAPP',
      subscribedAt: new Date(),
    });

    await this.trackingService.recordEvent(channel.projectId, {
      eventName: 'Lead',
      clientId: client.id,
      source: 'SERVER',
    });
  }
}
