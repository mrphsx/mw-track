import { IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsString, IsUrl } from 'class-validator';

// Зеркалит значения enum TrackingEvent из packages/types (PageView/Lead/Subscribe/
// Purchase/InitiateCheckout) + Click — отдельный пакет не подключаем ради одного
// списка строк, чтобы не тащить в это шаг сборку @trafficcrm/types.
// Unsubscribe — запрос пользователя 2026-07-29 ("добавь события отписки как с подпиской"):
// зеркалит Subscribe тем же путём (см. ClientsService.markUnsubscribed), не публичный SDK-вызов.
const KNOWN_EVENT_NAMES = ['PageView', 'Lead', 'Subscribe', 'Unsubscribe', 'Purchase', 'InitiateCheckout', 'Click'];

export class TrackEventDto {
  @IsIn(KNOWN_EVENT_NAMES)
  eventName: string;

  @IsOptional()
  @IsString()
  fbclid?: string;

  @IsOptional()
  @IsString()
  ttclid?: string;

  // Facebook Browser ID (_fbp cookie) — читается SDK на клике по кнопке Telegram
  // (apps/sdk/src/browser.ts), запрос пользователя 2026-07-29.
  @IsOptional()
  @IsString()
  fbp?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  tgUserId?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  pageUrl?: string;

  @IsOptional()
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  utmSource?: string;

  @IsOptional()
  @IsString()
  utmCampaign?: string;

  // Проставляется SDK (data-landing-id на теге track.js, apps/sdk/src/browser.ts) — для
  // статистики по конкретному лендингу, не только по проекту в целом.
  @IsOptional()
  @IsString()
  landingId?: string;

  // Проставляется SDK (data-ab-test-group-id, только когда заход пришёл через сплит A/B/n-
  // группы, запрос пользователя 2026-08-20) — группа считает строго свой собственный трафик,
  // не весь трафик лендинга-участника (см. LandingRendererService.injectTrackingScripts).
  @IsOptional()
  @IsString()
  abTestGroupId?: string;

  @IsOptional()
  @IsDateString()
  timestamp?: string;

  // Пиксель + рекламные макросы Facebook/TikTok (запрос пользователя 2026-07-04, трекинг-
  // ссылки лендинга "получить ссылку") — читаются SDK из query-параметров по кастомной карте
  // имён проекта (см. link-params.const.ts), сюда приходят уже под семантическими ключами
  // независимо от того, как назывался параметр в URL.
  @IsOptional()
  @IsString()
  pixelId?: string;

  @IsOptional()
  @IsString()
  adId?: string;

  @IsOptional()
  @IsString()
  adName?: string;

  @IsOptional()
  @IsString()
  adsetId?: string;

  @IsOptional()
  @IsString()
  adsetName?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  campaignName?: string;

  @IsOptional()
  @IsString()
  placement?: string;

  @IsOptional()
  @IsString()
  siteSourceName?: string;

  // Скрытая метка баера (Фаза 3.6, Team Analytics) — исторически считалось, что она долетает
  // сюда так же, как adId/campaignId (см. комментарий в link-params.const.ts), но поле здесь
  // отсутствовало вообще — из-за forbidNonWhitelisted:true в ValidationPipe это ломало 400-й
  // ЛЮБОЕ событие с трекинг-ссылки баера, не только те, что реально используют это значение
  // (реальная атрибуция баера идёт отдельным путём — start:<code>/landing-visit-buyer Redis-
  // мост, см. LandingRendererService — это поле здесь только чтобы запрос не отклонялся).
  // Найдено и добавлено 2026-07-21 (запрос пользователя, "чтобы всё было готово к запуску
  // трафика").
  @IsOptional()
  @IsString()
  buyerRef?: string;

  // Персистентный (localStorage) анонимный id визитора чистого веб-сайта (ChannelType.WEBSITE,
  // без Telegram/WA/IG) — apps/sdk/src/browser.ts, единственный способ узнать "тот же человек
  // вернулся" на сайте без мессенджера. См. Client.visitorId в schema.prisma. Отправляется с
  // КАЖДЫМ событием, но реально создаёт Client только для eventName:'Purchase' на WEBSITE-
  // проекте (см. TrackingService.recordEvent) — запрос пользователя 2026-09-03.
  @IsOptional()
  @IsString()
  visitorId?: string;
}
