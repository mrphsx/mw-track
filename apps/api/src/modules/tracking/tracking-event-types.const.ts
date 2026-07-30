// Каноничный список типов событий, для которых в CRM есть свитч вкл/выкл пересылки в
// Facebook/TikTok (запрос пользователя 2026-07-27, сужено 2026-07-27 тем же днём). Продублировано
// в apps/web/src/lib/tracking-events.ts (нет общего пакета между apps/web и apps/api в этом
// монорепо, тот же принцип, что и у link-params.const.ts).
//
// Намеренно НЕ все события, которые вообще проходят через TrackingService.recordEvent — только
// те, что CRM отправляет САМА, по своей внутренней логике, без явного trackEvent()-вызова со
// стороны кода лендинга/сайта (PageView/Lead/InitiateCheckout/Click — публичный SDK, тенант и
// так полностью контролирует, вызывать их или нет, прямо в своём коде лендинга — отдельный
// свитч в CRM для них избыточен). Subscribe/Dialogue/Purchase, наоборот, всегда решает сам
// бэкенд (TelegramProvider/ClientsService/PurchasesService) — тенант не может просто "не
// вызвать" это событие, поэтому именно для них нужен настоящий кил-свитч.
//
// У Dialogue и Purchase есть ещё и РУЧНОЙ путь (кнопка "Зарегистрировать диалог"/форма "Добавить
// покупку" в списке клиентов) — свитч гасит только АВТОМАТИЧЕСКОЕ срабатывание, ручная отправка
// продолжает работать даже при выключенном свитче (см. RecordEventDto.forceSend в
// tracking.service.ts, проставляется в ClientsService.applyDialogueUpdate/PurchasesService.create).
// Unsubscribe добавлен 2026-07-29 (запрос пользователя "добавь события отписки как с
// подпиской") — тот же принцип, что и у остальных трёх: решает сам бэкенд
// (ClientsService.markUnsubscribed), без явного вызова со стороны кода лендинга.
export const TRACKING_EVENT_TYPES = ['Subscribe', 'Unsubscribe', 'Dialogue', 'Purchase'] as const;
export type TrackingEventType = (typeof TRACKING_EVENT_TYPES)[number];
