// Общие типы движка правил клоакинга (запрос пользователя 2026-09-24, "довести до уровня
// Keitaro") — зеркалят backend enum'ы CloakingConditionField/CloakingActionType/
// CloakingRuleMatchLogic (schema.prisma) и форму config у каждого condition (см. evaluator'ы в
// apps/api/src/modules/landings/cloaking/conditions/).
export type CloakingConditionField =
  | 'COUNTRY'
  | 'REGION'
  | 'CITY'
  | 'IP'
  | 'REFERRER'
  | 'USER_AGENT'
  | 'X_REQUESTED_WITH'
  | 'LANGUAGE'
  | 'BROWSER'
  | 'BROWSER_VERSION'
  | 'OS'
  | 'OS_VERSION'
  | 'DEVICE_TYPE'
  | 'DEVICE_MODEL'
  | 'PARAMETER'
  | 'DATE_BETWEEN'
  | 'TIMETABLE'
  | 'LIMIT_CLICKS'
  | 'BOT'
  | 'UNIQUENESS'
  | 'PROXY'
  | 'ISP'
  | 'MOBILE_OPERATOR'
  | 'CONNECTION_TYPE';

export type CloakingActionType = 'ALLOW' | 'REDIRECT' | 'PRELANDING' | 'NOT_FOUND' | 'BLANK' | 'CUSTOM_HTML' | 'CUSTOM_TEXT';
export type CloakingRuleMatchLogic = 'AND' | 'OR';

// Платный тир Keitaro-парности (запрос пользователя 2026-09-24) — evaluator не реализован,
// видны в UI задизейбленными. Бэкенд тоже отклоняет их (LandingsService.assertCloakingConditionsAllowed).
export const PAID_CLOAKING_FIELDS: CloakingConditionField[] = ['PROXY', 'ISP', 'MOBILE_OPERATOR', 'CONNECTION_TYPE'];

// На тарифе TRIAL доступно только условие "Страна" (запрос пользователя 2026-09-25: "запрет на
// все опции клоакинга кроме страны... остальные опции сделай отключенными") — полный доступ
// открывается со Starter, см. значок в CloakingConditionRow. Бэкенд — тот же файл, что и выше
// (LandingsService.assertCloakingConditionsAllowed) — второй рубеж защиты, не единственный.
export const TRIAL_ALLOWED_CLOAKING_FIELDS: CloakingConditionField[] = ['COUNTRY'];

export const CLOAKING_FIELD_LABELS: Record<CloakingConditionField, string> = {
  COUNTRY: 'Страна',
  REGION: 'Регион',
  CITY: 'Город',
  IP: 'IP / CIDR',
  REFERRER: 'Referrer',
  USER_AGENT: 'User-Agent',
  X_REQUESTED_WITH: 'X-Requested-With',
  LANGUAGE: 'Язык браузера',
  BROWSER: 'Браузер',
  BROWSER_VERSION: 'Версия браузера',
  OS: 'ОС',
  OS_VERSION: 'Версия ОС',
  DEVICE_TYPE: 'Тип устройства',
  DEVICE_MODEL: 'Модель устройства',
  PARAMETER: 'Параметр ссылки',
  DATE_BETWEEN: 'Дата (диапазон)',
  TIMETABLE: 'Расписание (дни/часы)',
  LIMIT_CLICKS: 'Лимит показов',
  BOT: 'Бот (эвристика)',
  UNIQUENESS: 'Уникальность визита',
  PROXY: 'Proxy/VPN',
  ISP: 'Интернет-провайдер',
  MOBILE_OPERATOR: 'Мобильный оператор',
  CONNECTION_TYPE: 'Тип соединения',
};

export const CLOAKING_ACTION_LABELS: Record<CloakingActionType, string> = {
  ALLOW: 'Показать реальный лендинг',
  REDIRECT: 'Редирект',
  PRELANDING: 'White-страница',
  NOT_FOUND: '404',
  BLANK: 'Пустая страница',
  CUSTOM_HTML: 'Свой HTML',
  CUSTOM_TEXT: 'Свой текст',
};

export interface CloakingConditionState {
  // Клиентский временный id для React key/удаления строки — реальный id с сервера, если условие
  // уже сохранено (не отправляется в payload обратно, бэкенд сам генерирует cuid при create).
  clientId: string;
  field: CloakingConditionField;
  negate: boolean;
  config: Record<string, unknown>;
}

export interface CloakingRuleApiShape {
  id: string;
  name: string | null;
  position: number;
  isEnabled: boolean;
  matchLogic: CloakingRuleMatchLogic;
  action: CloakingActionType;
  actionRedirectUrl: string | null;
  actionCustomHtml: string | null;
  actionCustomText: string | null;
  conditions: { id: string; field: CloakingConditionField; negate: boolean; config: Record<string, unknown> }[];
}

export function emptyConfigForField(field: CloakingConditionField): Record<string, unknown> {
  switch (field) {
    case 'COUNTRY':
      return { countries: [] };
    case 'REGION':
      return { regions: [] };
    case 'CITY':
      return { cities: [] };
    case 'IP':
      return { ranges: [] };
    case 'REFERRER':
    case 'USER_AGENT':
      return { mode: 'contains', pattern: '' };
    case 'X_REQUESTED_WITH':
    case 'DEVICE_MODEL':
      return { mode: 'contains', pattern: '' };
    case 'LANGUAGE':
      return { languages: [] };
    case 'BROWSER':
      return { browsers: [] };
    case 'BROWSER_VERSION':
    case 'OS_VERSION':
      return { versions: [] };
    case 'OS':
      return { values: [] };
    case 'DEVICE_TYPE':
      return { types: [] };
    case 'PARAMETER':
      return { name: '', mode: 'contains', pattern: '' };
    case 'DATE_BETWEEN':
      return { from: '', to: '' };
    case 'TIMETABLE':
      return { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, days: [], hourFrom: 0, hourTo: 23 };
    case 'LIMIT_CLICKS':
      return { max: 100 };
    case 'UNIQUENESS':
      return { scope: 'ip' };
    case 'BOT':
    default:
      return {};
  }
}
