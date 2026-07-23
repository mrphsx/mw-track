// Словарь семантических полей трекинг-ссылки лендинга (пиксель + рекламные макросы Facebook/
// TikTok) — используется и настройками проекта (переименование параметров), и билдером ссылки
// в диалоге "Получить ссылку" (запрос пользователя 2026-07-04, спай-сервисы конкурентов легко
// палят рекламу по одинаковым ?pixel=&ad_id= у всех клиентов платформы).
//
// Продублировано в apps/api/src/modules/tracking/link-params.const.ts — нет общего пакета
// между apps/web и apps/api в этом монорепо, список маленький и стабильный.
export interface LinkParamField {
  key: string;
  label: string;
  default: string;
  // null — значение не макрос, а реальные данные (id выбранного пикселя)
  macro: string | null;
}

export const LINK_PARAM_FIELDS: LinkParamField[] = [
  // key должен совпадать с полем в TrackEventDto на бэкенде (найденный и исправленный
  // 2026-07-21 баг: ключ назывался 'pixel', а поле в DTO — pixelId, из-за чего ЛЮБОЕ событие
  // с трекинг-ссылки с пикселем отклонялось целиком строгой валидацией). Сам query-параметр
  // (?pixel=...) не меняется, только внутренний идентификатор.
  { key: 'pixelId', label: 'Пиксель', default: 'pixel', macro: null },
  { key: 'adId', label: 'ID объявления', default: 'ad_id', macro: '{{ad.id}}' },
  { key: 'adName', label: 'Название объявления', default: 'ad_name', macro: '{{ad.name}}' },
  { key: 'adsetId', label: 'ID группы объявлений', default: 'adset_id', macro: '{{adset.id}}' },
  { key: 'adsetName', label: 'Название группы объявлений', default: 'adset_name', macro: '{{adset.name}}' },
  { key: 'campaignId', label: 'ID кампании', default: 'campaign_id', macro: '{{campaign.id}}' },
  { key: 'campaignName', label: 'Название кампании', default: 'campaign_name', macro: '{{campaign.name}}' },
  { key: 'placement', label: 'Плейсмент', default: 'placement', macro: '{{placement}}' },
  { key: 'siteSourceName', label: 'Источник показа', default: 'site_source_name', macro: '{{site_source_name}}' },
  // Скрытая метка баера (Фаза 3.6, Team Analytics, запрос пользователя 2026-07-15) — реальное
  // значение (id баера), не рекламный макрос, поэтому macro: null, как у pixel. Добавляется в
  // ссылку только когда её берёт не-управленческий аккаунт (см. GetLinkDialog) — по умолчанию
  // короткое и ничего не говорящее имя, специально НЕ "buyer_id"/подобное.
  { key: 'buyerRef', label: 'Метка баера (скрытая)', default: 'z', macro: null },
];

export function resolveParamMap(linkParamMap: Record<string, string> | null | undefined): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const field of LINK_PARAM_FIELDS) {
    resolved[field.key] = linkParamMap?.[field.key] || field.default;
  }
  return resolved;
}

// Только безопасные для query-строки символы — совпадает с бэкендом (LINK_PARAM_NAME_REGEX).
export const LINK_PARAM_NAME_REGEX = /^[a-zA-Z0-9_]+$/;
