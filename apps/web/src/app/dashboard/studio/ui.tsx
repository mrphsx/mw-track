// Общие визуальные примитивы Studio, вынесенные при добавлении 2-й и 3-й страницы (Лендинги/
// Сценарии, запрос пользователя 2026-07-30: "учти всё что мы правили") — раньше карточка/пилюля/
// кнопка-действие дублировались inline в каждом файле (project/page.tsx). С ростом числа страниц
// дублирование стало тем самым "3 похожих файла — пора вынести в общее место", что уже разбирали
// на shared data layer (prototype-project-data.ts) раньше в этой же сессии. Радиус — актуальная
// на 2026-07-30 шкала (2-й раунд, "давай немного округленнее"): rounded-lg пилюли/кнопки/бейджи,
// rounded-xl карточки — см. историю в projects/[id]/page.tsx.
import Link from 'next/link';
import { LucideIcon } from 'lucide-react';
import { PeriodValue, StatsPeriod } from '@/components/shared/period-selector';
import { Input } from '@/components/ui/input';
import { STUDIO_HUES, StudioHueName } from './colors';

export const STUDIO_CARD = 'rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm';

export function StudioPill({ hue, danger, children }: { hue?: StudioHueName; danger?: boolean; children: React.ReactNode }) {
  if (danger) {
    return (
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-lg whitespace-nowrap bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400">
        {children}
      </span>
    );
  }
  const { textClass, bgSoftClass } = STUDIO_HUES[hue ?? 'slate'];
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-lg whitespace-nowrap ${bgSoftClass} ${textClass}`}>{children}</span>;
}

// Кнопка-пилюля как <Link> (переходы) — primary заполнена акцентом, secondary — белая с рамкой,
// тот же визуальный язык, что и у 4 кнопок действий на странице проекта.
export function StudioLinkButton({
  href,
  onClick,
  variant = 'secondary',
  icon: Icon,
  size = 'md',
  disabled,
  children,
}: {
  href?: string;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
  icon?: LucideIcon;
  size?: 'md' | 'sm';
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const cls = `inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors ${
    size === 'sm' ? 'text-xs px-3 py-1.5' : 'text-sm px-4 py-2'
  } ${
    variant === 'primary'
      ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] hover:opacity-90'
      : 'bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
  } ${disabled ? 'opacity-60 pointer-events-none' : ''}`;
  const content = (
    <>
      {Icon && <Icon className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />}
      {children}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {content}
    </button>
  );
}

const CLIENTS_PERIOD_OPTIONS: { value: StatsPeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
];

// Studio-версия выбора периода для страниц клиентов (запрос пользователя 2026-08-18: "выбор
// периода должен быть по дизайну как на странице проекта, а на странице клиенты он прозрачный и
// других цветов") — та же пилюльная вёрстка/цвета, что уже используется на странице проекта
// (projects/[id]/page.tsx, не вынесена оттуда — риск трогать уже работающую страницу ради
// одной новой), плюс явное "Все" (запрос: "изначально не будет выбран период никакой") —
// страница проекта такого состояния не поддерживает (её статистике всегда нужно окно дат), у
// списка клиентов "без фильтра по дате" — полноценное персистентное состояние, не просто дефолт.
export function StudioClientsPeriodPicker({ value, onChange }: { value: PeriodValue | null; onChange: (value: PeriodValue | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-1 gap-0.5">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
            value === null
              ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
              : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
          }`}
        >
          Все
        </button>
        {CLIENTS_PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange({ period: opt.value })}
            className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
              value?.period === opt.value
                ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ period: 'custom', from: value?.from, to: value?.to })}
          className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
            value?.period === 'custom'
              ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
              : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
          }`}
        >
          Период
        </button>
      </div>
      {value?.period === 'custom' && (
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
