'use client';

import { Input } from '@/components/ui/input';

export type StatsPeriod = 'today' | 'yesterday' | '7d' | '30d' | 'custom';

export interface PeriodValue {
  period: StatsPeriod;
  from?: string;
  to?: string;
}

const OPTIONS: { value: StatsPeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: 'custom', label: 'Период' },
];

// Селектор периода статистики (запрос пользователя 2026-07-17: "сегодня, вчера, 7 дней,
// 30 дней, кастомный период") — управляемый компонент, значение живёт в родителе, чтобы он
// же формировал query-параметры для всех зависящих от периода запросов (stats/funnel/
// ad-breakdown/leaderboards). from/to — обычные <input type="date"> вместо календаря: в
// проекте ещё нет ни одного date-range picker'а, а нативный date input покрывает кастомный
// период без новой зависимости.
export function PeriodSelector({ value, onChange }: { value: PeriodValue; onChange: (value: PeriodValue) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-border p-0.5 gap-0.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value === 'custom' ? { period: 'custom', from: value.from, to: value.to } : { period: opt.value })}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              value.period === opt.value ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {value.period === 'custom' && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={value.from ?? ''}
            max={value.to || undefined}
            onChange={(e) => onChange({ period: 'custom', from: e.target.value, to: value.to })}
            className="w-auto"
          />
          <span className="text-muted-foreground text-sm">—</span>
          <Input
            type="date"
            value={value.to ?? ''}
            min={value.from || undefined}
            onChange={(e) => onChange({ period: 'custom', from: value.from, to: e.target.value })}
            className="w-auto"
          />
        </div>
      )}
    </div>
  );
}
