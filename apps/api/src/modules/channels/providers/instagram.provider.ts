import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { ClientsService } from '../../clients/clients.service';
import { TrackingService } from '../../tracking/tracking.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChannelProvider, SendMessageOptions, UserStatus } from './channel.provider.interface';

// Instagram Direct через прямой Meta Graph API (Messenger Platform, Page-connected flow) —
// контракт сверен по developers.facebook.com на 2026-06-28, не по псевдокоду 05_BACKEND_CHANNELS.md
// (тот ходил на ${igPageId}/messages с Bearer-заголовком — неверно, реальный путь /me/messages
// с access_token query-параметром).
//
// Архитектурно отличается от Telegram/WhatsApp: там вебхук per-channel (свой URL на канал,
// per-channel секрет). У Instagram вебхук ОДИН на всё приложение (один URL, настраивается один
// раз в Meta App Dashboard), с верификацией через общий META_WEBHOOK_VERIFY_TOKEN (один обмен
// при подключении) и подписью через общий META_APP_SECRET (X-Hub-Signature-256, не per-channel).
// Поэтому handleWebhook здесь принимает ВЕСЬ payload (может содержать entries разных аккаунтов)
// и сам резолвит Channel по entry.id — в отличие от WhatsApp/Telegram, где channelId уже в URL.
@Injectable()
export class InstagramProvider implements ChannelProvider {
  private readonly logger = new Logger(InstagramProvider.name);
  private readonly baseUrl = 'https://graph.facebook.com/v18.0';

  constructor(
    private prisma: PrismaService,
    private clientsService: ClientsService,
    private trackingService: TrackingService,
  ) {}

  async initialize(channel: Channel): Promise<void> {
    if (!channel.igPageId || !channel.igAccessToken) {
      throw new Error('igPageId и igAccessToken обязательны для Instagram-канала');
    }

    // entry.id входящего вебхука — это Instagram Business Account ID, НЕ igPageId (Facebook
    // Page ID). Получаем и сохраняем один раз, чтобы handleWebhook мог матчить канал быстрым
    // запросом в БД, не дёргая Graph API на каждое входящее сообщение.
    const igAccountRes = await fetch(
      `${this.baseUrl}/${channel.igPageId}?fields=instagram_business_account&access_token=${channel.igAccessToken}`,
    );
    if (!igAccountRes.ok) {
      throw new Error(`Не удалось получить Instagram Business Account: ${igAccountRes.status} ${await igAccountRes.text()}`);
    }
    const igAccountData = (await igAccountRes.json()) as { instagram_business_account?: { id: string } };
    const igBusinessAccountId = igAccountData.instagram_business_account?.id;
    if (!igBusinessAccountId) {
      throw new Error('К этой Facebook Page не подключён Instagram Professional аккаунт');
    }

    // Подписка Page на messaging-вебхуки приложения — без этого Meta не будет слать события.
    const subscribeRes = await fetch(
      `${this.baseUrl}/${channel.igPageId}/subscribed_apps?subscribed_fields=messages&access_token=${channel.igAccessToken}`,
      { method: 'POST' },
    );
    if (!subscribeRes.ok) {
      throw new Error(`Не удалось подписать Page на вебхуки: ${subscribeRes.status} ${await subscribeRes.text()}`);
    }

    await this.prisma.channel.update({ where: { id: channel.id }, data: { igBusinessAccountId } });
  }

  async sendMessage(igsid: string, options: SendMessageOptions, channel: Channel): Promise<boolean> {
    if (!channel.igAccessToken) {
      this.logger.warn(`sendMessage: no igAccessToken for channel ${channel.id}`);
      return false;
    }

    try {
      const message: Record<string, unknown> = options.mediaUrl
        ? { attachment: { type: options.mediaType === 'video' ? 'video' : 'image', payload: { url: options.mediaUrl, is_reusable: false } } }
        : { text: options.text };

      // Generic-шаблон с кнопками (как у Telegram/WhatsApp) не реализован — Instagram Send API
      // требует отдельную структуру generic template, не тот же button-формат; не было в исходном
      // чеклисте этого шага, осознанно не строилось ради экономии объёма.
      const res = await fetch(`${this.baseUrl}/me/messages?access_token=${channel.igAccessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: igsid }, message }),
      });

      if (!res.ok) {
        this.logger.error(`Instagram sendMessage failed for channel ${channel.id}: ${res.status} ${await res.text()}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(`Instagram sendMessage error for channel ${channel.id}: ${(error as Error).message}`);
      return false;
    }
  }

  async getUserStatus(_channelUserId: string): Promise<UserStatus> {
    // Как и у WhatsApp — Graph API не даёт дешёвой проверки "доступен ли пользователь".
    return { isReachable: true, isSubscribed: true };
  }

  // X-Hub-Signature-256 — общий для приложения секрет (META_APP_SECRET), не per-channel.
  // Считается от СЫРЫХ байт тела (req.rawBody), вызывается из WebhooksController до парсинга.
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
    if (!signatureHeader?.startsWith('sha256=')) return false;
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    return signatureHeader.slice('sha256='.length) === expected;
  }

  // payload — весь Meta-конверт ({object:'instagram', entry:[...]}), может содержать
  // записи разных Instagram-аккаунтов сразу (Meta батчит несколько entries в одном вебхуке).
  async handleWebhook(payload: { object?: string; entry?: Array<{ id: string; messaging?: Array<Record<string, unknown>> }> }): Promise<void> {
    if (payload.object !== 'instagram' || !payload.entry) return;

    for (const entry of payload.entry) {
      const channel = await this.prisma.channel.findFirst({
        where: { type: 'INSTAGRAM', igBusinessAccountId: entry.id, isActive: true },
      });
      if (!channel) {
        this.logger.warn(`handleWebhook: no active Instagram channel for igBusinessAccountId ${entry.id}`);
        continue;
      }

      for (const event of entry.messaging || []) {
        const sender = event.sender as { id?: string } | undefined;
        const message = event.message as { text?: string; is_echo?: boolean } | undefined;
        // is_echo — это копия СВОЕГО исходящего сообщения, не входящее от пользователя.
        if (!message || message.is_echo || !sender?.id) continue;

        const client = await this.clientsService.findOrCreate({
          projectId: channel.projectId,
          igUserId: sender.id,
          channelType: 'INSTAGRAM',
          subscribedAt: new Date(),
        });

        await this.trackingService.recordEvent(channel.projectId, {
          eventName: 'Lead',
          clientId: client.id,
          source: 'SERVER',
        });
      }
    }
  }
}
