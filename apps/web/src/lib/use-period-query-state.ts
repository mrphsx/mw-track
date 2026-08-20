'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PeriodValue } from '@/components/shared/period-selector';

const PERIOD_VALUES = ['today', 'yesterday', '7d', '30d', 'custom'] as const;

function readPeriodFromSearchParams(params: URLSearchParams, defaultPeriod: PeriodValue['period']): PeriodValue {
  const period = params.get('period');
  if (period === 'custom') {
    const from = params.get('from') || undefined;
    const to = params.get('to') || undefined;
    if (from && to) return { period: 'custom', from, to };
  }
  if (period && (PERIOD_VALUES as readonly string[]).includes(period)) return { period: period as PeriodValue['period'] };
  return { period: defaultPeriod };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Конкретные даты для ЛЮБОГО периода, включая именованные пресеты (запрос пользователя
// 2026-08-18: "когда в пути вставляется период... ставь всегда параметры from to, а не просто
// today, 30d итд") — раньше from/to писались в URL только для period='custom', для остальных
// пресетов ссылка несла только голое имя ("period=7d"), которое при повторном открытии этой же
// ссылки в другой день означало бы уже ДРУГОЕ окно дат. Даты считаются по локальному времени
// браузера (не по часовому поясу проекта, который знает только бэкенд) — это осознанное
// приближение: сами from/to в URL нужны только чтобы ссылка была "self-contained"/шарабельной
// (показывала одно и то же окно при каждом открытии), а не для похода в API — реальный запрос
// к бэкенду по-прежнему шлёт period-пресет, и именно бэкенд считает since/until точно, в
// реальном часовом поясе проекта (см. resolveStatsPeriod), эти from/to с ним не смешиваются.
export function computePeriodDates(value: PeriodValue): { from: string; to: string } {
  if (value.period === 'custom') return { from: value.from ?? '', to: value.to ?? '' };

  const today = new Date();
  const todayStr = toDateStr(today);

  if (value.period === 'today') return { from: todayStr, to: todayStr };

  if (value.period === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = toDateStr(yesterday);
    return { from: yesterdayStr, to: yesterdayStr };
  }

  // 7d/30d — те же N календарных суток, что теперь считает и resolveStatsPeriod на бэкенде
  // (включая сегодня), не N*24 часов назад от текущего момента.
  const days = value.period === '7d' ? 7 : 30;
  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  return { from: toDateStr(from), to: todayStr };
}

// Персистентность выбранного периода в query-параметрах ссылки (?period=...&from=...&to=...) —
// изначально сделано только на классической странице проекта (запрос пользователя 2026-07-25:
// "при обновлении страницы должен остаться выбранный период"), затем реплицировано вручную
// копипастой на несколько других страниц. Запрос пользователя 2026-08-18: "везде где есть
// период, пусть хранится в пути ссылки start end date, чтобы после обновления не сбрасывалось" —
// вынесено сюда одним хуком, чтобы больше не копипастить один и тот же блок на каждую новую
// страницу с периодом (было отдельным `readPeriodFromSearchParams`/`setPeriodValue` в каждом
// файле по отдельности — см. историю страницы проекта). Каждый вызывающий передаёт свой
// дефолтный период (страница проекта — 'today', /my-stats/home — исторически '30d').
export function usePeriodQueryState(defaultPeriod: PeriodValue['period'] = 'today'): [PeriodValue, (next: PeriodValue) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [periodValue, setPeriodValueState] = useState<PeriodValue>(() => readPeriodFromSearchParams(searchParams, defaultPeriod));

  const setPeriodValue = (next: PeriodValue) => {
    setPeriodValueState(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('period', next.period);
    const dates = computePeriodDates(next);
    if (dates.from) params.set('from', dates.from); else params.delete('from');
    if (dates.to) params.set('to', dates.to); else params.delete('to');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return [periodValue, setPeriodValue];
}
