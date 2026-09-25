import { Injectable } from '@nestjs/common';
import { CloakingCondition } from '@prisma/client';
import { CloakingConditionEvaluator, CloakingEvalContext } from './condition-evaluator.interface';

// config: {countries: string[]} — ISO 3166-1 alpha-2, верхний регистр (тот же формат, что был у
// старого Landing.cloakingCountries). ctx.geo.country уже приведён к верхнему регистру в
// resolveVisitorGeo.
@Injectable()
export class CountryConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    if (!ctx.geo.country) return false;
    const countries = ((condition.config as { countries?: string[] })?.countries ?? []).map((c) => c.toUpperCase());
    return countries.includes(ctx.geo.country);
  }
}

// config: {regions: string[]} — коды регионов geoip-lite (напр. "MSK", те же значения, что
// возвращает сама библиотека — она вернёт региональный код провайдера ISO/FIPS в зависимости от
// страны).
@Injectable()
export class RegionConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    if (!ctx.geo.region) return false;
    const regions = ((condition.config as { regions?: string[] })?.regions ?? []).map((r) => r.toUpperCase());
    return regions.includes(ctx.geo.region.toUpperCase());
  }
}

// config: {cities: string[]} — точное совпадение без учёта регистра (geoip-lite отдаёт
// человекочитаемое название города на английском).
@Injectable()
export class CityConditionEvaluator implements CloakingConditionEvaluator {
  evaluate(condition: CloakingCondition, ctx: CloakingEvalContext): boolean {
    if (!ctx.geo.city) return false;
    const cities = ((condition.config as { cities?: string[] })?.cities ?? []).map((c) => c.toLowerCase());
    return cities.includes(ctx.geo.city.toLowerCase());
  }
}
