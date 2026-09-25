import { Injectable } from '@nestjs/common';
import { CloakingCondition } from '@prisma/client';
import { getClientIp } from '../../../../common/client-ip.util';
import { HOSTING_IP_RANGES } from '../hosting-ip-ranges';
import { CloakingConditionEvaluator, CloakingEvalContext } from './condition-evaluator.interface';
import { ipMatchesAnyRange } from './ip-range.util';

// config: {ranges: string[]} — каждый элемент IP-адрес или CIDR, IPv4 и IPv6 в одном списке
// (объединяет отдельные "IP"/"IPv6" фильтры Keitaro).
@Injectable()
export class IpConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const ip = getClientIp(ctx.req);
    if (!ip) return false;
    const ranges = (condition.config as { ranges?: string[] })?.ranges ?? [];
    return ipMatchesAnyRange(ip, ranges);
  }
}

// config: {} — эвристика без настроек: пустой User-Agent ИЛИ IP из известного датацентрового
// диапазона (см. HOSTING_IP_RANGES). Заведомо слабее платной базы ботов Keitaro — реальный
// пользователь на VPN/корпоративной сети тоже может попасть под неё, это осознанный компромисс
// бесплатного тира, явно описанный в подсказке UI рядом с этим условием.
@Injectable()
export class BotConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(_condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const userAgent = ctx.req.headers['user-agent'];
    if (!userAgent || !String(userAgent).trim()) return true;

    const ip = getClientIp(ctx.req);
    if (!ip) return false;
    return ipMatchesAnyRange(ip, HOSTING_IP_RANGES);
  }
}
