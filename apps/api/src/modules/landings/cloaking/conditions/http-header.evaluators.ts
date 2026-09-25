import { Injectable } from '@nestjs/common';
import { CloakingCondition } from '@prisma/client';
import { CloakingConditionEvaluator, CloakingEvalContext } from './condition-evaluator.interface';

const SEARCH_ENGINE_HOSTS = ['google.', 'bing.', 'yahoo.', 'yandex.', 'duckduckgo.', 'baidu.'];

// Общий матчинг "содержит подстроку / подходит под regex", переиспользуется REFERRER/
// USER_AGENT/X_REQUESTED_WITH ниже и DEVICE_MODEL (user-agent-parsed.evaluators.ts) — четыре
// разных условия в UI Keitaro, но одна и та же проверка под капотом.
export function matchesTextConfig(value: string, config: { mode?: string; pattern?: string }): boolean {
  const pattern = config?.pattern ?? '';
  if (config?.mode === 'regex') {
    try {
      return new RegExp(pattern, 'i').test(value);
    } catch {
      return false;
    }
  }
  return value.toLowerCase().includes(pattern.toLowerCase());
}

// config: {mode: 'contains'|'regex'|'empty'|'search_engine', pattern?: string}. 'empty'
// сворачивает Keitaro'вский отдельный фильтр "Empty referrer" в режим этого же условия;
// 'search_engine' — сворачивает "Search engines" (совпадение по домену из небольшого списка
// известных поисковиков, не отдельный тип).
@Injectable()
export class ReferrerConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const referrer = (ctx.req.headers['referer'] as string | undefined) ?? '';
    const config = (condition.config as { mode?: string; pattern?: string }) ?? {};

    if (config.mode === 'empty') return !referrer.trim();
    if (!referrer) return false;
    if (config.mode === 'search_engine') {
      const lower = referrer.toLowerCase();
      return SEARCH_ENGINE_HOSTS.some((host) => lower.includes(host));
    }
    return matchesTextConfig(referrer, config);
  }
}

// config: {mode: 'contains'|'regex'|'empty', pattern?: string}
@Injectable()
export class UserAgentConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const userAgent = (ctx.req.headers['user-agent'] as string | undefined) ?? '';
    const config = (condition.config as { mode?: string; pattern?: string }) ?? {};

    if (config.mode === 'empty') return !userAgent.trim();
    if (!userAgent) return false;
    return matchesTextConfig(userAgent, config);
  }
}

// config: {mode: 'contains'|'regex', pattern: string}
@Injectable()
export class XRequestedWithConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const header = (ctx.req.headers['x-requested-with'] as string | undefined) ?? '';
    if (!header) return false;
    return matchesTextConfig(header, (condition.config as { mode?: string; pattern?: string }) ?? {});
  }
}

// config: {languages: string[]} — первичные языковые теги (напр. "en", "ru", "es"),
// сравниваются с ПЕРВЫМ (наиболее предпочтительным) языком из Accept-Language без учёта
// региона/веса.
@Injectable()
export class LanguageConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const header = (ctx.req.headers['accept-language'] as string | undefined) ?? '';
    if (!header) return false;
    const primary = header.split(',')[0]?.split(';')[0]?.split('-')[0]?.trim().toLowerCase();
    if (!primary) return false;

    const languages = ((condition.config as { languages?: string[] })?.languages ?? []).map((l) => l.toLowerCase());
    return languages.includes(primary);
  }
}
