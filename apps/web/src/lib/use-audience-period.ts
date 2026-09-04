'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PeriodValue } from '@/components/shared/period-selector';
import { computePeriodDates } from './use-period-query-state';

// "За всё время" (запрос пользователя 2026-08-31) — только для страниц пересечения аудиторий,
// не общий 6й пункт в разделяемом PeriodSelector/usePeriodQueryState (те используются на 8+
// других страницах — project page/leaderboards/my-stats/clients/payment-details-log — ни одной
// из них "всё время" не просили, добавлять туда 6й пункт значило бы показать его всем разом).
// Отдельный небольшой хук вместо этого — тот же принцип "продублировать немного логики, а не
// усложнять общую утилиту ради одного потребителя", что уже применялся в этом проекте (см.
// память про ModuleRef vs. прямой импорт). 'all' — чисто фронтендовое понятие: бэкенду при этом
// периоде просто НЕ передаётся period вообще (AudienceService.resolvePeriodWindow уже трактует
// отсутствие period как "без фильтра", ровно то же самое поведение, что было ДО периода).
export type AudiencePeriod = PeriodValue['period'] | 'all';

export interface AudiencePeriodValue {
  period: AudiencePeriod;
  from?: string;
  to?: string;
}

const PERIOD_VALUES: AudiencePeriod[] = ['today', 'yesterday', '7d', '30d', 'custom', 'all'];

function readFromSearchParams(params: URLSearchParams, defaultPeriod: AudiencePeriod): AudiencePeriodValue {
  const period = params.get('period');
  if (period === 'custom') {
    const from = params.get('from') || undefined;
    const to = params.get('to') || undefined;
    if (from && to) return { period: 'custom', from, to };
  }
  if (period && (PERIOD_VALUES as string[]).includes(period)) return { period: period as AudiencePeriod };
  return { period: defaultPeriod };
}

// Даты нужны только именованным пресетам today/yesterday/7d/30d/custom — 'all' по определению
// не имеет границ, from/to для него просто не пишутся в URL вообще.
export function computeAudiencePeriodDates(value: AudiencePeriodValue): { from: string; to: string } {
  if (value.period === 'all') return { from: '', to: '' };
  return computePeriodDates(value as PeriodValue);
}

// То же query-параметры-в-URL персистентность, что usePeriodQueryState, плюс 'all'. Дефолт —
// '30d' (запрос пользователя 2026-08-31: "изначально поставь чтобы было за 30 дней").
export function useAudiencePeriodQueryState(
  defaultPeriod: AudiencePeriod = '30d',
): [AudiencePeriodValue, (next: AudiencePeriodValue) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [periodValue, setPeriodValueState] = useState<AudiencePeriodValue>(() => readFromSearchParams(searchParams, defaultPeriod));

  const setPeriodValue = (next: AudiencePeriodValue) => {
    setPeriodValueState(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('period', next.period);
    if (next.period === 'all') {
      params.delete('from');
      params.delete('to');
    } else {
      const dates = computeAudiencePeriodDates(next);
      if (dates.from) params.set('from', dates.from); else params.delete('from');
      if (dates.to) params.set('to', dates.to); else params.delete('to');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return [periodValue, setPeriodValue];
}

// Параметры для API-запроса — 'all' означает вообще не слать period (бэкендовый StatsPeriodDto
// не знает про 'all' и отклонил бы его @IsIn-валидатором, если бы он туда попал).
export function toApiPeriodParams(period: AudiencePeriodValue): Record<string, string | undefined> {
  if (period.period === 'all') return {};
  if (period.period === 'custom') return { period: 'custom', from: period.from, to: period.to };
  return { period: period.period };
}
