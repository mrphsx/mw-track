import { CloakingCondition } from '@prisma/client';
import { Request } from 'express';
import { VisitorGeo } from '../../../../common/geo-country.util';

// Узкий срез UAParser.IResult — ровно те поля, что реально нужны evaluator'ам ниже (не весь
// богатый интерфейс библиотеки), чтобы не завязываться на точную форму типов ua-parser-js.
export interface ParsedUserAgent {
  browser: { name?: string; version?: string };
  os: { name?: string; version?: string };
  device: { type?: string; model?: string };
}

// Строится ОДИН раз на запрос в CloakingService.applyCloaking (гео-лукап и разбор User-Agent —
// не бесплатные операции, чтобы их не повторять на каждое условие каждого правила) и передаётся
// во все evaluator'ы.
export interface CloakingEvalContext {
  req: Request;
  geo: VisitorGeo;
  ua: ParsedUserAgent;
  now: Date;
}

// Один класс на CloakingConditionField (см. CLOAKING_CONDITION_EVALUATORS в
// cloaking.service.ts) — тот же принцип реестра, что уже описан в CLAUDE.md для
// CloakingHandler/ChannelProvider. Добавление нового бесплатного условия в будущем = новый
// класс + новое значение enum CloakingConditionField + одна строка в реестре, без правок логики
// оценки правил.
export interface CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean | Promise<boolean>;
}
