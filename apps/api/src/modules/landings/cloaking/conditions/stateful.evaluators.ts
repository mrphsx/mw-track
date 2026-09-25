import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { CloakingCondition } from '@prisma/client';
import { RedisService } from '../../../../redis/redis.service';
import { getClientIp } from '../../../../common/client-ip.util';
import { CloakingConditionEvaluator, CloakingEvalContext } from './condition-evaluator.interface';

// Дефолт для UNIQUENESS, если windowSeconds не задан — "первый визит" считается таковым в
// пределах 30 дней, дальше ключ сам протухает и следующий визит того же посетителя снова
// считается первым (не бессрочная память).
const DEFAULT_UNIQUENESS_WINDOW_SECONDS = 30 * 24 * 60 * 60;

// config: {max: number, windowSeconds?: number} — счётчик в Redis, ключ по condition.id (не по
// ruleId — так несколько LIMIT_CLICKS-условий в разных правилах одного лендинга не делят один
// счётчик по ошибке). ВСЕГДА инкрементируется, когда это условие реально оценивается движком
// (см. CloakingService.applyCloaking) — даже если AND/OR теоретически могли бы закоротить
// раньше — иначе "лимит показов" будет считать не все реальные показы. true = "ещё в пределах
// лимита" (интуитивнее для сценария "показывать реальный лендинг первым N посетителям" через
// action=ALLOW; чтобы получить обратный смысл "заблокировать после N" — negate:true).
@Injectable()
export class LimitClicksConditionEvaluator implements CloakingConditionEvaluator {
  constructor(private redis: RedisService) {}

  async evaluate(condition: CloakingCondition): Promise<boolean> {
    const config = (condition.config as { max?: number; windowSeconds?: number }) ?? {};
    if (config.max === undefined) return false;

    const key = `cloaking-limit:${condition.id}`;
    const count = await this.redis.incr(key);
    if (count === 1 && config.windowSeconds) {
      await this.redis.expire(key, config.windowSeconds);
    }
    return count <= config.max;
  }
}

// config: {scope: 'ip'|'ip_ua', windowSeconds?: number} — true, если это первый визит с данным
// отпечатком (IP или IP+UA) в пределах окна. Ключ по condition.id, тот же приём, что и у
// LIMIT_CLICKS — несколько UNIQUENESS-условий не путают друг друга. negate:true даёт обратный
// смысл — "только повторные визиты".
@Injectable()
export class UniquenessConditionEvaluator implements CloakingConditionEvaluator {
  constructor(private redis: RedisService) {}

  async evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): Promise<boolean> {
    const config = (condition.config as { scope?: string; windowSeconds?: number }) ?? {};
    const ip = getClientIp(ctx.req);
    if (!ip) return false;

    const fingerprintSource = config.scope === 'ip_ua' ? `${ip}:${ctx.req.headers['user-agent'] ?? ''}` : ip;
    const fingerprint = createHash('sha256').update(fingerprintSource).digest('hex');
    const key = `cloaking-unique:${condition.id}:${fingerprint}`;
    const windowSeconds = config.windowSeconds || DEFAULT_UNIQUENESS_WINDOW_SECONDS;

    const result = await this.redis.set(key, '1', 'EX', windowSeconds, 'NX');
    return result === 'OK';
  }
}
