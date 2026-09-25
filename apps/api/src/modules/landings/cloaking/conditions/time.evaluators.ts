import { Injectable } from '@nestjs/common';
import { CloakingCondition } from '@prisma/client';
import { CloakingConditionEvaluator, CloakingEvalContext } from './condition-evaluator.interface';

// config: {from: string, to: string} — оба уже готовые UTC ISO-моменты (фронтенд конвертирует
// выбранную в форме дату/время в нужной зоне В UTC один раз при сохранении правила, тот же
// приём, что уже делает PushComposer через lib/timezone.ts zonedTimeToUtcIso — не пересчитывать
// зону на КАЖДЫЙ визит, достаточно один раз на сохранении).
@Injectable()
export class DateBetweenConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const config = (condition.config as { from?: string; to?: string }) ?? {};
    if (!config.from || !config.to) return false;
    const from = new Date(config.from).getTime();
    const to = new Date(config.to).getTime();
    const now = ctx.now.getTime();
    if (Number.isNaN(from) || Number.isNaN(to)) return false;
    return now >= from && now <= to;
  }
}

// config: {timezone: string, days: number[] (0=вс..6=сб), hourFrom: number, minuteFrom?: number,
// hourTo: number, minuteTo?: number} — в отличие от DATE_BETWEEN, это ПОВТОРЯЮЩЕЕСЯ расписание
// (день недели + диапазон часов), поэтому зону нужно резолвить на каждый визит, а не один раз
// при сохранении. Intl.DateTimeFormat с опцией timeZone — тот же беззатратный (без библиотек)
// приём, что уже применяется на фронтенде (lib/timezone.ts), просто на бэкенде.
@Injectable()
export class TimetableConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const config = (condition.config as {
      timezone?: string;
      days?: number[];
      hourFrom?: number;
      minuteFrom?: number;
      hourTo?: number;
      minuteTo?: number;
    }) ?? {};
    if (!config.days?.length || config.hourFrom === undefined || config.hourTo === undefined) return false;

    const timezone = config.timezone || 'UTC';
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        hourCycle: 'h23',
      }).formatToParts(ctx.now);
    } catch {
      return false;
    }

    const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN);
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekday = WEEKDAYS.indexOf(weekdayStr);
    if (weekday === -1 || Number.isNaN(hour) || Number.isNaN(minute)) return false;
    if (!config.days.includes(weekday)) return false;

    const nowMinutes = hour * 60 + minute;
    const fromMinutes = config.hourFrom * 60 + (config.minuteFrom ?? 0);
    const toMinutes = config.hourTo * 60 + (config.minuteTo ?? 0);
    return nowMinutes >= fromMinutes && nowMinutes <= toMinutes;
  }
}
