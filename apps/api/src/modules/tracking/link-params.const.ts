// Словарь семантических полей трекинг-ссылки лендинга (пиксель + рекламные макросы Facebook/
// TikTok) → дефолтное имя query-параметра. Кастомизируется per-project через Project.
// linkParamMap (запрос пользователя 2026-07-04 — одинаковые ?pixel=&ad_id= у всех клиентов
// платформы легко палятся спай-сервисами конкурентов, имена должны быть переопределяемыми).
//
// Продублировано в apps/web/src/lib/link-params.ts — нет общего пакета между apps/web и
// apps/api в этом монорепо, список маленький и стабильный, дублирование сознательное.
// Семантический ключ ДОЛЖЕН совпадать с именем поля в TrackEventDto (apps/api/src/modules/
// tracking/dto/track-event.dto.ts) — SDK шлёт значение под этим именем в JSON-теле POST
// /track/:publicToken/event, а там глобальный ValidationPipe с forbidNonWhitelisted:true:
// любое поле без соответствия в DTO рушит ВЕСЬ запрос 400-й, а не просто игнорируется. Баг
// найден и исправлен 2026-07-21 (запрос пользователя, "чтобы всё было готово к запуску
// трафика"): ключ назывался 'pixel', а в DTO — pixelId, из-за чего каждое событие с трекинг-
// ссылки с привязанным пикселем (и, из-за sessionStorage-мерджа в SDK, вообще ВСЕ события той
// же сессии посетителя) отклонялось целиком. Переименовано в 'pixelId' — сам query-параметр в
// ссылке (?pixel=...) не меняется, меняется только этот внутренний идентификатор.
export const LINK_PARAM_KEYS = [
  'pixelId',
  'adId',
  'adName',
  'adsetId',
  'adsetName',
  'campaignId',
  'campaignName',
  'placement',
  'siteSourceName',
  // Скрытая метка баера (Фаза 3.6, Team Analytics) — та же категория бага, что и pixel выше:
  // этот ключ никогда не имел соответствия в TrackEventDto (в отличие от adId/campaignId,
  // которые действительно совпадают с полями DTO) — то есть КАЖДАЯ трекинг-ссылка баера
  // (не управленческого аккаунта, см. GetLinkDialog) ломала весь трекинг по клику на неё.
  // Исправлено тем же 2026-07-21 фиксом — добавлено соответствующее поле в DTO (там же см.
  // комментарий), само значение по-прежнему используется только через отдельный
  // start:<code>/landing-visit-buyer Redis-мост (LandingRendererService), не через это поле
  // напрямую — оно нужно просто чтобы ValidationPipe не отклонял запрос целиком.
  'buyerRef',
] as const;

export type LinkParamKey = (typeof LINK_PARAM_KEYS)[number];

export const DEFAULT_LINK_PARAM_MAP: Record<LinkParamKey, string> = {
  pixelId: 'pixel',
  adId: 'ad_id',
  adName: 'ad_name',
  adsetId: 'adset_id',
  adsetName: 'adset_name',
  campaignId: 'campaign_id',
  campaignName: 'campaign_name',
  placement: 'placement',
  siteSourceName: 'site_source_name',
  buyerRef: 'z',
};

// linkParamMap — частичное переопределение дефолтов ({ adId: 'zid1' } и т.п.), хранится как
// Project.linkParamMap (Json?, null = все дефолты).
export function resolveParamMap(linkParamMap: unknown): Record<LinkParamKey, string> {
  const overrides = (linkParamMap && typeof linkParamMap === 'object' ? linkParamMap : {}) as Partial<
    Record<LinkParamKey, string>
  >;
  const resolved = { ...DEFAULT_LINK_PARAM_MAP };
  for (const key of LINK_PARAM_KEYS) {
    if (overrides[key]) resolved[key] = overrides[key] as string;
  }
  return resolved;
}

// Обратный словарь для чтения входящего query: фактическое имя параметра → семантический ключ.
export function invertParamMap(paramMap: Record<LinkParamKey, string>): Record<string, LinkParamKey> {
  const inverted: Record<string, LinkParamKey> = {};
  for (const key of LINK_PARAM_KEYS) {
    inverted[paramMap[key]] = key;
  }
  return inverted;
}

// Валидация кастомных имён параметров (CreateProjectDto/UpdateProjectDto) — только
// безопасные для query-строки символы, чтобы ссылку можно было собирать конкатенацией
// строк без экранирования ключей.
export const LINK_PARAM_NAME_REGEX = /^[a-zA-Z0-9_]+$/;
