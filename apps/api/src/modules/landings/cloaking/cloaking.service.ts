import { Injectable } from '@nestjs/common';
import { CloakingActionType, CloakingCondition, CloakingConditionField, CloakingRuleMatchLogic, Landing } from '@prisma/client';
import { Request, Response } from 'express';
import UAParser from 'ua-parser-js';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveVisitorGeo } from '../../../common/geo-country.util';
import { CloakingHandler } from './cloaking-handler.interface';
import { RedirectCloakingHandler } from './redirect-cloaking.handler';
import { PrelandingCloakingHandler } from './prelanding-cloaking.handler';
import { NotFoundCloakingHandler } from './not-found-cloaking.handler';
import { BlankCloakingHandler } from './blank-cloaking.handler';
import { CustomHtmlCloakingHandler } from './custom-html-cloaking.handler';
import { CustomTextCloakingHandler } from './custom-text-cloaking.handler';
import { CloakingConditionEvaluator, CloakingEvalContext } from './conditions/condition-evaluator.interface';
import { CountryConditionEvaluator, RegionConditionEvaluator, CityConditionEvaluator } from './conditions/geo.evaluators';
import { IpConditionEvaluator, BotConditionEvaluator } from './conditions/network.evaluators';
import {
  ReferrerConditionEvaluator,
  UserAgentConditionEvaluator,
  XRequestedWithConditionEvaluator,
  LanguageConditionEvaluator,
} from './conditions/http-header.evaluators';
import {
  BrowserConditionEvaluator,
  BrowserVersionConditionEvaluator,
  OsConditionEvaluator,
  OsVersionConditionEvaluator,
  DeviceTypeConditionEvaluator,
  DeviceModelConditionEvaluator,
} from './conditions/user-agent-parsed.evaluators';
import { ParameterConditionEvaluator } from './conditions/parameter.evaluator';
import { DateBetweenConditionEvaluator, TimetableConditionEvaluator } from './conditions/time.evaluators';
import { LimitClicksConditionEvaluator, UniquenessConditionEvaluator } from './conditions/stateful.evaluators';

// Движок правил клоакинга (запрос пользователя 2026-09-24, "довести до уровня Keitaro") —
// заменяет собой прежнюю однострочную проверку "страна из allow-list". Лендинг может иметь
// несколько именованных CloakingRule (см. schema.prisma), каждое — набор CloakingCondition с
// логикой AND/OR и действием при совпадении. Правила оцениваются по порядку (position), первое
// совпавшее решает исход; если ни одно не совпало — посетитель видит реальный лендинг (тот же
// дефолт, что был у старого плоского клоакинга).
//
// Реестр evaluator'ов/handler'ов — тот же принцип, что уже был у CloakingHandler и
// ChannelProvider: добавление нового бесплатного условия/действия = новый класс + новая строка
// здесь, без правок логики оценки. PROXY/ISP/MOBILE_OPERATOR/CONNECTION_TYPE намеренно
// отсутствуют в conditionEvaluators — платный тир Keitaro, evaluator не реализован (см.
// CloakingConditionField в schema.prisma); строка с таким field в БД в принципе не должна
// появиться (DTO/сервис их отклоняют), но даже если бы появилась — условие просто никогда не
// совпадёт, а не уронит оценку правила.
@Injectable()
export class CloakingService {
  private readonly conditionEvaluators: Partial<Record<CloakingConditionField, CloakingConditionEvaluator>>;
  private readonly actionHandlers: Partial<Record<Exclude<CloakingActionType, 'ALLOW'>, CloakingHandler>>;

  constructor(
    private prisma: PrismaService,
    redirectHandler: RedirectCloakingHandler,
    prelandingHandler: PrelandingCloakingHandler,
    notFoundHandler: NotFoundCloakingHandler,
    blankHandler: BlankCloakingHandler,
    customHtmlHandler: CustomHtmlCloakingHandler,
    customTextHandler: CustomTextCloakingHandler,
    countryEvaluator: CountryConditionEvaluator,
    regionEvaluator: RegionConditionEvaluator,
    cityEvaluator: CityConditionEvaluator,
    ipEvaluator: IpConditionEvaluator,
    botEvaluator: BotConditionEvaluator,
    referrerEvaluator: ReferrerConditionEvaluator,
    userAgentEvaluator: UserAgentConditionEvaluator,
    xRequestedWithEvaluator: XRequestedWithConditionEvaluator,
    languageEvaluator: LanguageConditionEvaluator,
    browserEvaluator: BrowserConditionEvaluator,
    browserVersionEvaluator: BrowserVersionConditionEvaluator,
    osEvaluator: OsConditionEvaluator,
    osVersionEvaluator: OsVersionConditionEvaluator,
    deviceTypeEvaluator: DeviceTypeConditionEvaluator,
    deviceModelEvaluator: DeviceModelConditionEvaluator,
    parameterEvaluator: ParameterConditionEvaluator,
    dateBetweenEvaluator: DateBetweenConditionEvaluator,
    timetableEvaluator: TimetableConditionEvaluator,
    limitClicksEvaluator: LimitClicksConditionEvaluator,
    uniquenessEvaluator: UniquenessConditionEvaluator,
  ) {
    this.actionHandlers = {
      REDIRECT: redirectHandler,
      PRELANDING: prelandingHandler,
      NOT_FOUND: notFoundHandler,
      BLANK: blankHandler,
      CUSTOM_HTML: customHtmlHandler,
      CUSTOM_TEXT: customTextHandler,
    };

    this.conditionEvaluators = {
      COUNTRY: countryEvaluator,
      REGION: regionEvaluator,
      CITY: cityEvaluator,
      IP: ipEvaluator,
      BOT: botEvaluator,
      REFERRER: referrerEvaluator,
      USER_AGENT: userAgentEvaluator,
      X_REQUESTED_WITH: xRequestedWithEvaluator,
      LANGUAGE: languageEvaluator,
      BROWSER: browserEvaluator,
      BROWSER_VERSION: browserVersionEvaluator,
      OS: osEvaluator,
      OS_VERSION: osVersionEvaluator,
      DEVICE_TYPE: deviceTypeEvaluator,
      DEVICE_MODEL: deviceModelEvaluator,
      PARAMETER: parameterEvaluator,
      DATE_BETWEEN: dateBetweenEvaluator,
      TIMETABLE: timetableEvaluator,
      LIMIT_CLICKS: limitClicksEvaluator,
      UNIQUENESS: uniquenessEvaluator,
    };
  }

  // true — запрос уже полностью обработан (посетитель заблокирован и получил альтернативный
  // контент), renderAndServe должен вернуться сразу же. false — клоакинг выключен, у лендинга
  // нет правил, либо ни одно правило не совпало (либо совпало с action=ALLOW) — рендерить
  // реальный лендинг как обычно.
  async applyCloaking(landing: Landing, subPath: string, req: Request, res: Response): Promise<boolean> {
    if (!landing.cloakingEnabled) return false;

    const rules = await this.prisma.cloakingRule.findMany({
      where: { landingId: landing.id, isEnabled: true },
      orderBy: { position: 'asc' },
      include: { conditions: true },
    });
    if (rules.length === 0) return false;

    const ctx: CloakingEvalContext = {
      req,
      geo: resolveVisitorGeo(req),
      ua: new UAParser(req.headers['user-agent'] as string | undefined).getResult(),
      now: new Date(),
    };

    for (const rule of rules) {
      if (!(await this.ruleMatches(rule.matchLogic, rule.conditions, ctx))) continue;

      if (rule.action === 'ALLOW') return false;
      const handler = this.actionHandlers[rule.action];
      if (!handler) return false; // defensive — не должно случиться, action всегда из известного enum
      await handler.serveBlockedVisitor(landing, rule, subPath, req, res);
      return true;
    }

    return false;
  }

  private async ruleMatches(matchLogic: CloakingRuleMatchLogic, conditions: CloakingCondition[], ctx: CloakingEvalContext): Promise<boolean> {
    // Пустой список условий — правило-catch-all, совпадает всегда (самое нижнее правило без
    // условий — обычный способ задать дефолтное действие для "всех остальных").
    if (conditions.length === 0) return true;

    // LIMIT_CLICKS обязан инкрементироваться при КАЖДОЙ реальной оценке правила, даже если OR
    // уже нашёл true раньше по списку, поэтому оцениваем ВСЕ условия правила (без short-circuit
    // по индексу), а затем сворачиваем результаты по matchLogic — не самый дешёвый вариант, но
    // единственный, что даёт предсказуемый счётчик показов.
    const results: boolean[] = [];
    for (const condition of conditions) {
      const evaluator = this.conditionEvaluators[condition.field];
      const raw = evaluator ? await evaluator.evaluate(condition, ctx) : false;
      results.push(condition.negate ? !raw : raw);
    }

    return matchLogic === 'OR' ? results.some(Boolean) : results.every(Boolean);
  }
}
