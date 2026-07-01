// Должно зеркалить apps/api/src/modules/tracking/dto/track-event.dto.ts ровно —
// ValidationPipe там настроен с forbidNonWhitelisted:true, так что лишнее поле
// (utmMedium/utmContent/utmTerm/tgUsername/referrer из исходного черновика SDK)
// не отбрасывается тихо, а валит запрос 400-кой.
export type EventName = 'PageView' | 'Lead' | 'Subscribe' | 'Purchase' | 'InitiateCheckout' | 'Click';

export interface EventData {
  fbclid?: string;
  ttclid?: string;
  email?: string;
  phone?: string;
  tgUserId?: string;
  pageUrl?: string;
  value?: number;
  currency?: string;
  orderId?: string;
  idempotencyKey?: string;
  utmSource?: string;
  utmCampaign?: string;
  timestamp?: string;
}

export interface TrackClientOptions {
  projectId: string;
  secretKey: string;
  apiUrl?: string;
  debug?: boolean;
}

export interface TrackResult {
  eventId: string;
  success: boolean;
}
