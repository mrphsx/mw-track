import { createHmac } from 'crypto';
import { EventData, EventName, TrackClientOptions, TrackResult } from './types';

// HMAC-подпись и эндпоинт ниже зеркалят apps/api/src/modules/tracking/tracking.controller.ts
// (`trackServerEvent`) — это не иллюстративный пример, а контракт, проверенный живым тестом.
export class TrackClient {
  private readonly projectId: string;
  private readonly secretKey: string;
  private readonly apiUrl: string;
  private readonly debug: boolean;

  constructor(options: TrackClientOptions) {
    if (!options.projectId) throw new Error('[TrafficCRM] projectId is required');
    if (!options.secretKey) throw new Error('[TrafficCRM] secretKey is required');

    this.projectId = options.projectId;
    this.secretKey = options.secretKey;
    this.apiUrl = options.apiUrl || 'https://api.trafficcrm.io/api/v1';
    this.debug = options.debug || false;
  }

  async event(eventName: EventName, data: EventData = {}): Promise<TrackResult> {
    const timestamp = Date.now().toString();
    const body = JSON.stringify({ eventName, ...data });

    // Подпись считается от тех же байт, что реально уходят в теле запроса (см. body ниже) —
    // сервер сверяет подпись с req.rawBody, а не с повторным JSON.stringify своей стороны.
    const signature = 'sha256=' + createHmac('sha256', this.secretKey).update(`${timestamp}.${body}`).digest('hex');

    if (this.debug) console.log(`[TrafficCRM] Sending event: ${eventName}`, data);

    try {
      const response = await fetch(`${this.apiUrl}/track/server/${this.projectId}/event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
          'X-Timestamp': timestamp,
        },
        body,
      });

      if (!response.ok) {
        if (this.debug) console.error('[TrafficCRM] API error:', await response.json().catch(() => null));
        return { eventId: '', success: false };
      }

      // Контроллер возвращает {eventId} напрямую — в этом API нет общей обёртки
      // {success,data} для успешных ответов, только для ошибок (HttpExceptionFilter).
      const result = (await response.json()) as { eventId: string };
      if (this.debug) console.log('[TrafficCRM] Event sent:', result);
      return { eventId: result.eventId, success: true };
    } catch (error) {
      if (this.debug) console.error('[TrafficCRM] Network error:', error);
      return { eventId: '', success: false };
    }
  }

  pageView(data?: EventData): Promise<TrackResult> {
    return this.event('PageView', data);
  }

  lead(data?: EventData): Promise<TrackResult> {
    return this.event('Lead', data);
  }

  subscribe(data?: EventData): Promise<TrackResult> {
    return this.event('Subscribe', data);
  }

  initiateCheckout(value?: number, currency = 'USD', data?: EventData): Promise<TrackResult> {
    return this.event('InitiateCheckout', { value, currency, ...data });
  }

  purchase(amount: number, currency = 'USD', data?: EventData): Promise<TrackResult> {
    return this.event('Purchase', { value: amount, currency, ...data });
  }
}

export type { EventData, EventName, TrackClientOptions, TrackResult };
