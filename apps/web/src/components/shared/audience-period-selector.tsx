'use client';

import { Input } from '@/components/ui/input';
import { AudiencePeriodValue } from '@/lib/use-audience-period';

const OPTIONS: { value: Exclude<AudiencePeriodValue['period'], 'custom'>; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: 'all', label: 'Всё время' },
];

// Тот же визуальный язык, что и общий PeriodSelector (components/shared/period-selector.tsx),
// но с 6м пунктом "Всё время" — отдельный компонент, а не правка общего, т.к. общий используется
// на 8+ других страницах, которым этот пункт не нужен (запрос пользователя 2026-08-31 был
// ограничен явно: "на этих страницах", про страницы пересечения аудиторий).
export function AudiencePeriodSelector({
  value,
  onChange,
}: {
  value: AudiencePeriodValue;
  onChange: (value: AudiencePeriodValue) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-border p-0.5 gap-0.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange({ period: opt.value })}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              value.period === opt.value ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ period: 'custom', from: value.from, to: value.to })}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
            value.period === 'custom' ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          Период
        </button>
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
