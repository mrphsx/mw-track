import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { TrackingEvent, TrackingPixel } from '@prisma/client';
import { PixelProvider, PixelSendResult } from './providers/pixel.provider.interface';

@Injectable()
export class FacebookCAPIService implements PixelProvider {
  private readonly logger = new Logger(FacebookCAPIService.name);
  private readonly baseUrl = 'https://graph.facebook.com/v18.0';

  async sendEvent(event: TrackingEvent, pixel: TrackingPixel): Promise<PixelSendResult> {
    try {
      const payload = event.payload as Record<string, unknown>;

      // Порядок полей ниже (запрос пользователя 2026-07-29, "точь-в-точь как у конкурента") —
      // fbc, fbp, client_ip_address, client_user_agent, country, subscription_id, затем
      // em/ph (их нет в примере конкурента вообще, но если email/phone реально собраны —
      // отправлять их полезно, ставим в конец, а не в начало как было раньше).
      const userData: Record<string, unknown> = {};
      // Таймстамп в fbc должен быть моментом, когда fbclid РЕАЛЬНО был впервые увиден, не
      // моментом отправки — баг-репорт пользователя 2026-07-28 (сверка с рабочим примером
      // конкурента): раньше здесь всегда стоял Date.now(), то есть "сейчас" — для событий,
      // отправленных с задержкой (Subscribe/Dialogue пришли через минуты/часы после клика),
      // это выдумывало заведомо неверный момент клика. fbclidCapturedAt приходит из
      // TrackingService.resolveAttribution (реальное время создания Client при первом визите,
      // либо момент самого текущего события, если fbclid пришёл только что).
      if (payload.fbclid) {
        const capturedAt = payload.fbclidCapturedAt ? new Date(payload.fbclidCapturedAt as string).getTime() : new Date(event.eventTime).getTime();
        userData.fbc = `fb.1.${capturedAt}.${payload.fbclid}`;
      }
      // fbp — запрос пользователя 2026-07-29 (сверка с реальным примером конкурента), уже в
      // готовом формате _fbp cookie (fb.1.<время>.<random>), просто прокидываем как есть.
      if (payload.fbp) userData.fbp = payload.fbp;
      if (payload.ipAddress) userData.client_ip_address = payload.ipAddress;
      if (payload.userAgent) userData.client_user_agent = payload.userAgent;
      // country — ДОЛЖЕН быть lowercase ISO 3166-1 alpha-2 код перед хэшированием, не полное
      // название страны (хэш от "Russia" никогда не совпадёт с хэшем FB от "ru" — выглядело бы
      // как рабочий фикс, но было бы бесполезным). payload.countryCode приходит уже в этом
      // формате (Client.countryCode, см. TrackingService.resolveAttribution).
      if (payload.countryCode) userData.country = sha256(String(payload.countryCode).toLowerCase());
      // subscription_id — запрос пользователя 2026-07-29: в примере конкурента это реальный
      // числовой ID подписки; для Telegram-канала естественный эквивалент — сам Telegram user id
      // подписчика (не хэшируется, как и в примере конкурента).
      if (payload.tgUserId) userData.subscription_id = String(payload.tgUserId);
      if (payload.email) userData.em = [sha256(String(payload.email).toLowerCase().trim())];
      if (payload.phone) userData.ph = [sha256(String(payload.phone).replace(/\D/g, ''))];
      // external_id — баг-репорт пользователя 2026-07-24: Subscribe/Purchase/Dialogue уходили
      // с ошибкой "Invalid parameter" (Graph API code 100) — Facebook отклоняет пустой
      // user_data:{}. Раньше добавлялся ВСЕГДА, безусловно — правка 2026-07-29 (запрос
      // пользователя "убрать external_id, чтобы совпадало с примером конкурента, у них его
      // нет"): теперь только как последний фолбэк, когда ВСЁ остальное выше отсутствует —
      // сейчас, когда fbc/fbp/ip/ua/country почти всегда есть, это практически никогда не
      // сработает на реальных событиях с атрибуцией, но не даёт снова словить тот же баг
      // на событии, где вообще ничего не набралось.
      if (Object.keys(userData).length === 0 && event.clientId) userData.external_id = sha256(event.clientId);

      const eventData: Record<string, unknown> = {
        event_name: event.eventName,
        event_time: Math.floor(new Date(event.eventTime).getTime() / 1000),
        // event_source_url — только у браузерных событий (payload.pageUrl), для Telegram-
        // событий отсутствует и просто выпадает из JSON (undefined), как и в примере конкурента.
        event_source_url: payload.pageUrl,
        // Запрос пользователя 2026-07-30: живой A/B-тест на пикселе niggaragua1 (два идентичных
        // Subscribe с одинаковым test_event_code, разным action_source) показал byte-identical
        // ответ Facebook (HTTP 200, events_received:1, messages:[]) для 'chat' и 'website' —
        // предупредил, что реальной разницы на уровне API нет и это может быть UI-фильтр Meta,
        // а не проблема доставки, но пользователь явно решил всё равно переключить все боевые
        // события на 'website' (ранее, 2026-07-28, здесь стояло 'chat' по примеру конкурента —
        // намеренная замена этого решения, не забытый старый код). Тестовые события (кнопка
        // "Проверка ивента") — единственное место, где 'chat' всё ещё достижим, через явный
        // payload.forceActionSource из PixelsService.buildTestEvent.
        action_source: (payload.forceActionSource as string) || 'website',
        user_data: userData,
        // custom_data/data_processing_options — запрос пользователя 2026-07-29: у конкурента
        // оба поля присутствуют всегда, даже пустыми (custom_data: [] когда нечего передать —
        // сам Facebook в остальных случаях ждёт объект, не массив, поэтому реальные данные
        // Purchase ниже перезаписывают это настоящим объектом; data_processing_options: []
        // означает "без ограничений обработки данных" (CCPA и т.п.), безопасный дефолт.
        custom_data: [],
        data_processing_options: [],
        // event_id — последним полем (запрос пользователя 2026-07-29, порядок точь-в-точь как
        // у конкурента), функционально Facebook порядок ключей не важен, только визуально.
        event_id: event.eventId, // обязательно для дедупликации на стороне FB
      };

      if (event.eventName === 'Purchase' && payload.value) {
        eventData.custom_data = {
          value: payload.value,
          currency: payload.currency || 'USD',
          order_id: payload.orderId,
        };
      }

      const body: Record<string, unknown> = {
        data: [eventData],
        access_token: pixel.accessToken,
      };
      if (pixel.testEventCode) body.test_event_code = pixel.testEventCode;

      // Запрос пользователя 2026-07-28: "добавь логирование точно как у конкурентов" — их
      // пример нёс и отправленный payload, и полученный ответ рядом. access_token не логируем
      // (секрет), остального (event_id, action_source, user_data-ключи и т.п.) достаточно,
      // чтобы сверить с тем, что реально ушло, не восстанавливая это вручную из кода. test_event_code
      // — не секрет, логируем отдельно (баг-репорт пользователя 2026-07-29: "на страницу тестовых
      // ивентов ничего не появилось" — раньше нельзя было даже проверить по логам, действительно
      // ли он ушёл, раз он снаружи eventData, не внутри него).
      this.logger.log(
        `FB CAPI request for pixel ${pixel.id} (project ${pixel.projectId}): ${JSON.stringify(eventData)}` +
          (pixel.testEventCode ? ` test_event_code=${pixel.testEventCode}` : ' (без test_event_code)'),
      );

      // Массив, не голый объект (запрос пользователя 2026-07-29: сверка с реальным примером
      // конкурента) — так события реально уходят в Facebook (`data: [...]`), и так их показывает
      // конкурентский пример; хранить/показывать голый eventData в логах было расхождением с тем,
      // что действительно ушло по проводу.
      const requestPayload = [eventData];

      const response = await fetch(`${this.baseUrl}/${pixel.pixelId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const httpStatus = response.status;

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const fbError = errBody?.error;
        const message = fbError?.message || `HTTP ${response.status}`;
        // Раньше логировалось/сохранялось только message — терялись code/error_subcode/
        // error_user_msg/fbtrace_id, из-за чего диагностика "Invalid parameter" (общая
        // формулировка для десятка разных причин) требовала лезть напрямую в БД и
        // реконструировать payload вручную вместо того, чтобы просто прочитать точную причину
        // в логе (баг-репорт пользователя 2026-07-24).
        const detail = fbError
          ? ` [code=${fbError.code} subcode=${fbError.error_subcode ?? '-'} user_msg="${fbError.error_user_msg ?? '-'}" trace=${fbError.fbtrace_id ?? '-'}]`
          : '';
        this.logger.error(`FB CAPI error for pixel ${pixel.id} (project ${pixel.projectId}): ${message}${detail}`);
        return { success: false, error: `${message}${detail}`, requestPayload, responsePayload: errBody, httpStatus, testEventCode: pixel.testEventCode };
      }

      const resBody = await response.json().catch(() => ({}));

      // Баг-репорт пользователя 2026-07-28: "лог говорит всё нормально, отправлено, но на фб
      // ничего не поступило" — раньше из ответа сохранялся только fbtrace_id, а
      // events_received/messages (где Facebook реально сообщает, принято ли событие,
      // HTTP при этом всё равно 200) молча терялись. Логируем ответ целиком всегда, не
      // только при ошибке.
      const eventsReceived = resBody?.events_received;
      const messages = resBody?.messages;
      this.logger.log(
        `FB CAPI response for pixel ${pixel.id} (project ${pixel.projectId}), event ${event.eventName}: ` +
          `events_received=${eventsReceived ?? '?'} fbtrace_id=${resBody?.fbtrace_id ?? '-'}` +
          `${messages?.length ? ` messages=${JSON.stringify(messages)}` : ''}`,
      );

      if (eventsReceived === 0) {
        const warning = `Facebook ответил 200, но events_received=0${messages?.length ? `: ${JSON.stringify(messages)}` : ' (без пояснения)'}`;
        this.logger.warn(`FB CAPI event NOT actually received for pixel ${pixel.id} (project ${pixel.projectId}): ${warning}`);
        return { success: true, warning, externalEventId: resBody?.fbtrace_id, requestPayload, responsePayload: resBody, httpStatus, testEventCode: pixel.testEventCode };
      }

      return { success: true, externalEventId: resBody?.fbtrace_id, requestPayload, responsePayload: resBody, httpStatus, testEventCode: pixel.testEventCode };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`FB CAPI error for pixel ${pixel.id} (project ${pixel.projectId}): ${message}`);
      return { success: false, error: message };
    }
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
