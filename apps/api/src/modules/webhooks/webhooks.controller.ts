import { Body, Controller, Get, Headers, Param, Post, Query, RawBodyRequest, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { TelegramProvider } from '../channels/providers/telegram.provider';
import { WhatsAppProvider } from '../channels/providers/whatsapp.provider';
import { InstagramProvider } from '../channels/providers/instagram.provider';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private telegramProvider: TelegramProvider,
    private whatsAppProvider: WhatsAppProvider,
    private instagramProvider: InstagramProvider,
    private config: ConfigService,
  ) {}

  @Public()
  @Post('telegram/:channelId')
  async telegramWebhook(@Param('channelId') channelId: string, @Body() update: object) {
    await this.telegramProvider.handleWebhook(channelId, update);
    return { ok: true };
  }

  @Public()
  @Post('whatsapp/:channelId')
  async whatsappWebhook(
    @Param('channelId') channelId: string,
    @Headers('authorization') authHeader: string | undefined,
    @Body() payload: object,
  ) {
    await this.whatsAppProvider.handleWebhook(channelId, authHeader, payload);
    return { ok: true };
  }

  // Один вебхук на всё приложение (не per-channel, как у Telegram/WhatsApp) — настраивается
  // один раз в Meta App Dashboard. GET — одноразовая верификация при подключении вебхука:
  // Meta шлёт hub.mode/hub.verify_token/hub.challenge, мы должны эхом вернуть hub.challenge,
  // если verify_token совпадает с нашим META_WEBHOOK_VERIFY_TOKEN.
  @Public()
  @Get('instagram')
  verifyInstagramWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expected = this.config.get<string>('META_WEBHOOK_VERIFY_TOKEN');
    if (mode === 'subscribe' && expected && verifyToken === expected) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('Forbidden');
  }

  // X-Hub-Signature-256 — общий для приложения секрет (META_APP_SECRET), считается от
  // СЫРЫХ байт тела (req.rawBody, см. main.ts rawBody:true), не от тела после парсинга JSON.
  @Public()
  @Post('instagram')
  async instagramWebhook(
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() payload: { object?: string; entry?: Array<{ id: string; messaging?: Array<Record<string, unknown>> }> },
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    const appSecret = this.config.get<string>('META_APP_SECRET');
    if (!appSecret || !req.rawBody || !this.instagramProvider.verifySignature(req.rawBody, signature, appSecret)) {
      res.status(403).send('Invalid signature');
      return;
    }

    await this.instagramProvider.handleWebhook(payload);
    res.status(200).json({ ok: true });
  }
}
