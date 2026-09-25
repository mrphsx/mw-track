'use client';

// Мульти-выбор с поиском по вводу (запрос пользователя 2026-09-25: "нельзя ли подсказки при
// вводе для страны/браузера, люди могут ошибиться в написании") — для списков с сотнями
// вариантов (страны, браузеры, ОС) простой MultiSelect без фильтра неюзабелен. Написан с нуля
// (не через DropdownMenu/Combobox из @base-ui/react) — оба варианта либо не пробовались с
// произвольным <input> внутри в этом кодбейзе, либо требуют изучения незнакомого здесь API;
// самодостаточная реализация на голом React-стейте предсказуема и её проще целиком проверить.
import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';

export interface SearchableOption {
  value: string;
  label: string;
  // Доп. варианты написания, по которым тоже должен находиться пункт (запрос пользователя
  // 2026-09-25: "чтобы находилось даже если вбиваем на английском, сейчас только по русским
  // находит" — например английское имя страны/языка рядом с русской подписью). value ниже
  // тоже всегда участвует в поиске без явного указания — так код "RU"/"ru" находится всегда.
  keywords?: string[];
}

const MAX_VISIBLE_OPTIONS = 200;

export function SearchableMultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Выбрать...',
  searchPlaceholder = 'Поиск...',
}: {
  options: SearchableOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  const filtered = query.trim()
    ? options.filter((o) => {
        const q = query.trim().toLowerCase();
        return (
          o.label.toLowerCase().includes(q) ||
          o.value.toLowerCase().includes(q) ||
          (o.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false)
        );
      })
    : options;
  const visible = filtered.slice(0, MAX_VISIBLE_OPTIONS);

  const triggerLabel =
    value.length === 0
      ? placeholder
      : value.length <= 3
        ? value.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ')
        : `Выбрано: ${value.length}`;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none h-8 dark:bg-input/30 dark:hover:bg-input/50',
        )}
      >
        <span className={cn('truncate text-left', value.length === 0 && 'text-muted-foreground')}>{triggerLabel}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-64 rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          <div className="border-b border-border p-1.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent px-1.5 py-1 text-sm outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {visible.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Ничего не найдено</div>}
            {visible.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <Checkbox checked={value.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
                <span className="truncate">{o.label}</span>
              </button>
            ))}
            {filtered.length > MAX_VISIBLE_OPTIONS && (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">Показаны первые {MAX_VISIBLE_OPTIONS} из {filtered.length} — уточните запрос</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
