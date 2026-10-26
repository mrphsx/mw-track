'use client';

import { cn } from '@/lib/utils';

// Выбор периода на телефоне — обычный выпадающий список вместо ряда пилюль (2026-10-26: «выбор
// периода везде сделаем селектом для телефонов»). Виден только на узком экране (sm:hidden); рядом
// в каждом выборе периода пилюли скрыты на телефоне (hidden sm:flex). Значение — строка варианта.
export function MobilePeriodSelect({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Период"
      className={cn(
        'sm:hidden h-9 min-w-[9rem] rounded-lg px-3 text-sm font-medium outline-none shadow-sm bg-white dark:bg-[#171F2B] border border-[#DCE1E8] dark:border-white/10 text-[#131A24] dark:text-[#E9EDF3]',
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
