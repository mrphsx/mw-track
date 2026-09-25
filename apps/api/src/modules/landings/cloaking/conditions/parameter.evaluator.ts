import { Injectable } from '@nestjs/common';
import { CloakingCondition } from '@prisma/client';
import { CloakingConditionEvaluator, CloakingEvalContext } from './condition-evaluator.interface';

// config: {name: string, mode: 'equals'|'contains'|'regex'|'empty'|'not_empty', pattern?: string}
// — покрывает Keitaro'вские Parameter/Sub ID 1-30/Ad Campaign ID/Creative ID/Keyword/Site одним
// универсальным условием: у нас имена параметров и так настраиваются per-project (paramMap), так
// что отдельные типы под конкретные названия параметров были бы избыточны.
@Injectable()
export class ParameterConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const config = (condition.config as { name?: string; mode?: string; pattern?: string }) ?? {};
    if (!config.name) return false;

    const raw = ctx.req.query[config.name];
    const value = Array.isArray(raw) ? String(raw[0] ?? '') : typeof raw === 'string' ? raw : '';

    if (config.mode === 'empty') return !value.trim();
    if (config.mode === 'not_empty') return !!value.trim();
    if (!value) return false;
    if (config.mode === 'equals') return value === (config.pattern ?? '');
    if (config.mode === 'regex') {
      try {
        return new RegExp(config.pattern ?? '', 'i').test(value);
      } catch {
        return false;
      }
    }
    // 'contains' (дефолт)
    return value.toLowerCase().includes((config.pattern ?? '').toLowerCase());
  }
}
