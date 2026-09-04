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

// Тот же пилюльный дизайн, что на странице проекта (Studio), плюс "Всё время" — общий на оба
// audience-роута Studio (матрица + страница пары), но не в общем ui.tsx: специфичен только этой
// фиче (запрос пользователя 2026-08-31 был явно ограничен "на этих страницах").
export function StudioAudiencePeriodPicker({
  value,
  onChange,
}: {
  value: AudiencePeriodValue;
  onChange: (value: AudiencePeriodValue) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-1 gap-0.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange({ period: opt.value })}
            className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
              value.period === opt.value
                ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ period: 'custom', from: value.from, to: value.to })}
          className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
            value.period === 'custom'
              ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
              : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
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
            className="w-auto rounded-lg bg-white dark:bg-[#171F2B] dark:border-white/10 shadow-sm"
          />
          <span className="text-[#5F6B7A] dark:text-[#92A0AF] text-sm">—</span>
          <Input
            type="date"
            value={value.to ?? ''}
            min={value.from || undefined}
            onChange={(e) => onChange({ period: 'custom', from: value.from, to: e.target.value })}
            className="w-auto rounded-lg bg-white dark:bg-[#171F2B] dark:border-white/10 shadow-sm"
          />
        </div>
      )}
    </div>
  );
}
