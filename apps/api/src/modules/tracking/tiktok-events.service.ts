import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { TrackingEvent, TrackingPixel } from '@prisma/client';
import { PixelProvider, PixelSendResult } from './providers/pixel.provider.interface';

@Injectable()
export class TikTokEventsService implements PixelProvider {
  private readonly logger = new Logger(TikTokEventsService.name);
  private readonly baseUrl = 'https://business-api.tiktok.com/open_api/v1.3';

  private readonly eventMap: Record<string, string> = {
    PageView: 'ViewContent',
    Lead: 'SubmitForm',
    Subscribe: 'Subscribe',
    Purchase: 'CompletePayment',
    InitiateCheckout: 'InitiateCheckout',
  };

  async sendEvent(event: TrackingEvent, pixel: TrackingPixel): Promise<PixelSendResult> {
    try {
      const payload = event.payload as Record<string, unknown>;
      const ttEventName = this.eventMap[event.eventName] || event.eventName;

      // Проверка по официальной схеме TikTok Events API (запрос пользователя 2026-07-29,
      // "сверь чтобы для тиктока не было багов") — js_sdk/docs/PixelContextUser.md,
      // PixelContext.md, PixelContextAd.md, PixelContextPage.md, PixelTrackBody.md в
      // https://github.com/tiktok/tiktok-business-api-sdk (официальный SDK-репозиторий TikTok).
      // Раньше здесь было НЕСКОЛЬКО реальных структурных багов, найденных сверкой с этой схемой,
      // не просто "не хватает поля":
      // 1) email/phone_number/external_id/ttp принадлежат PixelContextUser — вложенному
      //    объекту context.user, а не отдельному полю body.user на одном уровне с context.
      // 2) ip/user_agent принадлежат ТОЛЬКО context (PixelContext), их вообще нет в схеме
      //    PixelContextUser — раньше дублировались (неправильно) ещё и в user.ip/user.user_agent.
      // 3) ttclid — это context.ad.callback (PixelContextAd), а не user.ttclid — TikTok никогда
      //    не читал бы его из того места, где мы его раньше клали.
      // external_id (PixelContextUser.external_id, СТРОКА, не массив — в отличие от Facebook,
      // где em/ph — массивы) — прямой аналог Facebook external_id, добавлен как основной
      // идентификатор для server-side событий без email/phone (что почти всегда так для
      // Telegram-событий), не как последний фолбэк — у TikTok, в отличие от Facebook, это
      // единственный слот под пользовательский идентификатор в context.user, кроме email/phone.
      const contextUser: Record<string, unknown> = {};
      if (payload.email) contextUser.email = sha256(String(payload.email).toLowerCase().trim());
      if (payload.phone) contextUser.phone_number = sha256(String(payload.phone).replace(/\D/g, ''));
      if (event.clientId) contextUser.external_id = sha256(event.clientId);

      const context: Record<string, unknown> = {
        page: { url: payload.pageUrl },
      };
      if (payload.userAgent) context.user_agent = payload.userAgent;
      if (payload.ipAddress) context.ip = payload.ipAddress;
      if (payload.ttclid) context.ad = { callback: payload.ttclid };
      if (Object.keys(contextUser).length > 0) context.user = contextUser;

      // properties — только документированные поля PixelProperties.md (value/currency);
      // order_id раньше отправлялся, но такого поля в схеме нет вообще — убрано, не выдумываем
      // несуществующее место для него без подтверждения, что TikTok его действительно читает.
      const properties: Record<string, unknown> = {};
      if (event.eventName === 'Purchase' && payload.value) {
        properties.value = payload.value;
        properties.currency = payload.currency || 'USD';
      }

      // ВАЖНО: PixelTrackBody — плоский объект (event/pixel_code/event_id/timestamp/context/
      // properties), БЕЗ обёртки в массив/data — это не то же самое, что Facebook CAPI. Массив
      // событий за один запрос — отдельный эндпоинт /pixel/batch/ (body: {pixel_code, batch:[...]}),
      // не /pixel/track/. Раньше здесь тело оборачивалось в {data:[body]} по аналогии с Facebook
      // без проверки по факту — реальный баг, из-за которого TikTok не нашёл бы event/pixel_code
      // и т.п. полей там, где ждёт их (они оказались бы на уровень глубже, внутри
      // несуществующего для этого эндпоинта поля data).
      const body: Record<string, unknown> = {
        pixel_code: pixel.pixelId,
        event: ttEventName,
        event_id: event.eventId,
        timestamp: new Date(event.eventTime).toISOString(),
        context,
        properties,
      };

      // Запрос пользователя 2026-07-28: "добавь логирование точно как у конкурентов" — отправляемый
      // payload и полученный ответ рядом, точно так же, как для Facebook CAPI. access_token — в
      // заголовке, не в теле, поэтому весь body безопасно логировать целиком.
      this.logger.log(`TikTok Events request for pixel ${pixel.id} (project ${pixel.projectId}): ${JSON.stringify(body)}`);

      const response = await fetch(`${this.baseUrl}/pixel/track/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Access-Token': pixel.accessToken },
        body: JSON.stringify(body),
      });
      const httpStatus = response.status;

      const resBody = await response.json().catch(() => ({}));

      // Баг-репорт пользователя 2026-07-28 (тот же класс проблемы, что и у Facebook CAPI):
      // TikTok Events API оборачивает реальный статус в JSON-поле code/message даже при
      // HTTP 200 — раньше при response.ok тело ответа не читалось вообще, поэтому code !== 0
      // (реальная ошибка на стороне TikTok — неверный access token, отклонённое событие и
      // т.п.) молча считался успехом. Логируем ответ целиком всегда. request_id — TikTok-овский
      // аналог fbtrace_id (подтверждено живым запросом к реальному API 2026-07-29), кладём в
      // externalEventId для показа в Pixel Logs UI — раньше это поле для TikTok не заполнялось
      // вообще.
      this.logger.log(
        `TikTok Events response for pixel ${pixel.id} (project ${pixel.projectId}), event ${event.eventName}: ` +
          `code=${resBody?.code ?? '?'} message="${resBody?.message ?? '-'}" request_id=${resBody?.request_id ?? '-'}` +
          `${resBody?.data ? ` data=${JSON.stringify(resBody.data)}` : ''}`,
      );

      if (!response.ok || (typeof resBody?.code === 'number' && resBody.code !== 0)) {
        const message = resBody?.message || `HTTP ${response.status}`;
        this.logger.error(`TikTok Events error for pixel ${pixel.id} (project ${pixel.projectId}): code=${resBody?.code ?? '?'} ${message}`);
        return { success: false, error: `code=${resBody?.code ?? '?'} ${message}`, requestPayload: body, responsePayload: resBody, httpStatus };
      }

      return { success: true, externalEventId: resBody?.request_id, requestPayload: body, responsePayload: resBody, httpStatus };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`TikTok Events error for pixel ${pixel.id} (project ${pixel.projectId}): ${message}`);
      return { success: false, error: message };
    }
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
