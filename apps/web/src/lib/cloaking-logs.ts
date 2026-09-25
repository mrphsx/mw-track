// Журнал заблокированных клоакингом заходов (запрос пользователя 2026-09-25: "сохранять логи
// фильтрации... кто по какому условию и когда был отфильтрован") — типы + `GET
// /landings/:id/cloaking/logs` ответа (LandingsService.listCloakingLogs) и человекочитаемое
// резюме config каждого сработавшего условия для таблицы логов.
import { CloakingActionType, CloakingConditionField } from '@/components/cloaking/cloaking-types';

export interface CloakingLogCondition {
  field: CloakingConditionField;
  negate: boolean;
  config: Record<string, unknown>;
}

export interface CloakingLogRequestSnapshot {
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
  acceptLanguage: string | null;
  geo: { country: string | null; region: string | null; city: string | null };
  ua: {
    browser: string | null;
    browserVersion: string | null;
    os: string | null;
    osVersion: string | null;
    deviceType: string | null;
    deviceModel: string | null;
  };
  query: Record<string, unknown>;
  path: string | null;
}

export interface CloakingLogRow {
  id: string;
  ruleId: string | null;
  ruleName: string | null;
  action: CloakingActionType;
  matchedConditions: CloakingLogCondition[];
  requestSnapshot: CloakingLogRequestSnapshot;
  createdAt: string;
}

export interface CloakingLogsResponse {
  rows: CloakingLogRow[];
  total: number;
  page: number;
  limit: number;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

// Не пытается покрыть форму config идеально для каждого поля — короткое резюме для таблицы
// логов, а не полноценный редактор (тот уже есть в ConditionConfigEditor на странице правил).
export function summarizeConditionConfig(field: CloakingConditionField, config: Record<string, unknown>): string {
  switch (field) {
    case 'COUNTRY':
      return asStringArray(config.countries).join(', ') || '—';
    case 'REGION':
      return asStringArray(config.regions).join(', ') || '—';
    case 'CITY':
      return asStringArray(config.cities).join(', ') || '—';
    case 'IP':
      return asStringArray(config.ranges).join(', ') || '—';
    case 'REFERRER':
    case 'USER_AGENT':
    case 'X_REQUESTED_WITH':
    case 'DEVICE_MODEL':
      if (config.mode === 'empty') return 'пусто';
      if (config.mode === 'search_engine') return 'поисковик';
      return `${config.mode === 'regex' ? 'regex' : 'содержит'}: ${config.pattern ?? ''}`;
    case 'LANGUAGE':
      return asStringArray(config.languages).join(', ') || '—';
    case 'BROWSER':
      return asStringArray(config.browsers).join(', ') || '—';
    case 'BROWSER_VERSION':
    case 'OS_VERSION':
      return asStringArray(config.versions).join(', ') || '—';
    case 'OS':
      return asStringArray(config.values).join(', ') || '—';
    case 'DEVICE_TYPE':
      return asStringArray(config.types).join(', ') || '—';
    case 'PARAMETER':
      return `${config.name ?? '?'} ${config.mode === 'regex' ? 'regex' : 'содержит'}: ${config.pattern ?? ''}`;
    case 'DATE_BETWEEN':
      return `${config.from ?? '?'} — ${config.to ?? '?'}`;
    case 'TIMETABLE':
      return `${asStringArray(config.days).join(',') || 'все дни'} ${config.hourFrom ?? 0}–${config.hourTo ?? 23}ч`;
    case 'LIMIT_CLICKS':
      return `до ${config.max ?? '?'} показов`;
    case 'UNIQUENESS':
      return config.scope === 'ip_ua' ? 'по IP+UA' : 'по IP';
    case 'BOT':
    default:
      return '';
  }
}
