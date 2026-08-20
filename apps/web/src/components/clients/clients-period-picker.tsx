'use client';

import { Input } from '@/components/ui/input';
import { PeriodValue, StatsPeriod } from '@/components/shared/period-selector';

const OPTIONS: { value: StatsPeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: 'custom', label: 'Период' },
];

// Период с явным "Все" (запрос пользователя 2026-08-18: "изначально не будет выбран период
// никакой и показывает всех клиентов") — обычный PeriodSelector (components/shared/period-selector)
// всегда несёт одно из 5 значений, здесь же null — полноценное самостоятельное состояние "без
// фильтра по дате вообще", а не просто дефолт до первого клика. Отдельный компонент, а не правка
// PeriodSelector — тот уже используется 6 страницами (проект/главная/моя статистика) с
// non-nullable value/onChange, менять его публичный контракт ради одной страницы клиентов рискованно.
export function ClientsPeriodPicker({ value, onChange }: { value: PeriodValue | null; onChange: (value: PeriodValue | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-border p-0.5 gap-0.5">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
            value === null ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          Все
        </button>
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value === 'custom' ? { period: 'custom', from: value?.from, to: value?.to } : { period: opt.value })}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              value?.period === opt.value ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {value?.period === 'custom' && (
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
