import { TrackingEvent, TrackingPixel } from '@prisma/client';

export interface PixelSendResult {
  success: boolean;
  error?: string;
  // Баг-репорт пользователя 2026-07-28: "лог говорит всё нормально, отправлено, но на фб
  // ничего не поступило" — HTTP 200 от Facebook/TikTok не гарантирует, что событие реально
  // засчитано (events_received: 0 у FB, code !== 0 у TikTok — оба могут прийти с успешным
  // статусом). warning — для именно такого случая: success остаётся true (запрос технически
  // прошёл), но платформа сигналит, что событие могло не долететь по факту.
  warning?: string;
  externalEventId?: string; // например, ID события, который вернул Facebook
  // Реальные тело запроса и ответ платформы (запрос пользователя 2026-07-28: "сделай как у
  // конкурентов, полностью с отчётом", видно в UI логов пикселей проекта) — без access_token
  // (см. TrackingEventDelivery.requestPayload в schema.prisma).
  requestPayload?: unknown;
  responsePayload?: unknown;
  // Реальный HTTP-код ответа платформы (конкурентский пример пользователя показывал его отдельной
  // строкой "HTTP Status: 200" — success:true не то же самое, что HTTP 200 читается напрямую).
  httpStatus?: number;
  // Test Event Code, реально использованный в этой отправке (запрос пользователя 2026-07-29:
  // "покажи весь запрос, так как на страницу тестовых ивентов ничего не появилось") — не секрет
  // (в отличие от access_token), но живёт вне requestPayload (тот — точная копия eventData/
  // per-event объекта "точь-в-точь как у конкурента", test_event_code в реальном запросе —
  // отдельное поле body, СНАРУЖИ data[], не внутри него — squeeze его туда испортил бы точность
  // примера). Показывается отдельной строкой в UI, чтобы явно видеть, действительно ли код ушёл.
  testEventCode?: string | null;
}

// Один интерфейс на платформу (Facebook/TikTok/...), без if/else в TrackingProcessor —
// тот же паттерн, что ChannelProvider для каналов (см. channels/providers).
export interface PixelProvider {
  sendEvent(event: TrackingEvent, pixel: TrackingPixel): Promise<PixelSendResult>;
}
