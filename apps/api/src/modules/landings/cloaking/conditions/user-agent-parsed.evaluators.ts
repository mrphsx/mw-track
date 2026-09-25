import { Injectable } from '@nestjs/common';
import { CloakingCondition } from '@prisma/client';
import { CloakingConditionEvaluator, CloakingEvalContext } from './condition-evaluator.interface';
import { matchesTextConfig } from './http-header.evaluators';

// config: {browsers: string[]} — "contains"-матчинг обеих сторон в нижнем регистре, чтобы
// "Safari" в списке ловил и "Mobile Safari", не только точное совпадение имени от ua-parser-js.
@Injectable()
export class BrowserConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const name = ctx.ua.browser.name?.toLowerCase();
    if (!name) return false;
    const browsers = ((condition.config as { browsers?: string[] })?.browsers ?? []).map((b) => b.toLowerCase());
    return browsers.some((b) => name.includes(b));
  }
}

// config: {versions: string[]} — совпадение по префиксу версии (напр. "16" ловит "16.2.1").
@Injectable()
export class BrowserVersionConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const version = ctx.ua.browser.version;
    if (!version) return false;
    const versions = (condition.config as { versions?: string[] })?.versions ?? [];
    return versions.some((v) => version.startsWith(v));
  }
}

// config: {values: string[]}
@Injectable()
export class OsConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const name = ctx.ua.os.name?.toLowerCase();
    if (!name) return false;
    const values = ((condition.config as { values?: string[] })?.values ?? []).map((v) => v.toLowerCase());
    return values.some((v) => name.includes(v));
  }
}

// config: {versions: string[]} — тот же префиксный матчинг, что и BROWSER_VERSION.
@Injectable()
export class OsVersionConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const version = ctx.ua.os.version;
    if (!version) return false;
    const versions = (condition.config as { versions?: string[] })?.versions ?? [];
    return versions.some((v) => version.startsWith(v));
  }
}

// config: {types: ('desktop'|'mobile'|'tablet'|'console'|'smarttv'|'wearable'|'embedded'|'other')[]}
// — ua-parser-js оставляет device.type === undefined для настольных браузеров (нет отдельного
// значения "desktop"), поэтому нормализуем undefined -> 'desktop'; остальные значения
// (console/smarttv/wearable/embedded) отдаём как есть — это реальные категории, которые
// ua-parser-js действительно умеет различать (запрос пользователя 2026-09-25 просил более
// широкий список категорий устройств; часть присланных им категорий — car_browser/
// smart_display/camera/portable_media_player — ua-parser-js в принципе не различает, у него
// таких значений нет, поэтому их здесь не может быть даже теоретически). 'other' — страховка на
// случай, если библиотека когда-нибудь начнёт возвращать значение, которого сейчас не существует.
const KNOWN_DEVICE_TYPES = ['mobile', 'tablet', 'console', 'smarttv', 'wearable', 'embedded'];

@Injectable()
export class DeviceTypeConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const raw = ctx.ua.device.type;
    const normalized = !raw ? 'desktop' : KNOWN_DEVICE_TYPES.includes(raw) ? raw : 'other';
    const types = (condition.config as { types?: string[] })?.types ?? [];
    return types.includes(normalized);
  }
}

// config: {mode: 'contains'|'regex', pattern: string}
@Injectable()
export class DeviceModelConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    const model = ctx.ua.device.model;
    if (!model) return false;
    return matchesTextConfig(model, (condition.config as { mode?: string; pattern?: string }) ?? {});
  }
}
