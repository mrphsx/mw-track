'use client';

// Одиночный выбор с поиском по вводу — для фильтров, где вариантов много и они приходят из
// реальных данных (кампании/группы объявлений/объявления проекта) либо из большого справочника
// (страны). Запрос пользователя 2026-10-02: "сделай дропдаун, чтобы можно было выбрать из
// существующих... там тоже есть дропдаун с странами, можешь оттуда посмотреть как сделано".
//
// Отдельный компонент, а не флаг single у SearchableMultiSelect (components/cloaking): тот уже
// работает в условиях клоакинга и завязан на массив значений с чекбоксами, а здесь значение
// одиночное (ClientsFilterState.campaignName и соседние — строки) и нужен пункт "Все" для
// сброса. Поведение открытия/поиска/закрытия по клику вне — то же, что у него.
import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SearchableSelectOption {
  value: string;
  label: string;
  // Доп. написания для поиска (например английское имя страны рядом с русской подписью) — см.
  // COUNTRY_OPTIONS в components/cloaking/country-list.ts. value тоже всегда участвует в поиске.
  keywords?: string[];
}

const MAX_VISIBLE_OPTIONS = 200;

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Все',
  searchPlaceholder = 'Поиск...',
  emptyLabel = 'Все',
  id,
}: {
  options: SearchableSelectOption[];
  value?: string;
  onChange: (next: string | undefined) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  id?: string;
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

  const pick = (next: string | undefined) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

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

  // Значение, которого уже нет в списке (сохранённый в URL фильтр по удалённой кампании),
  // показываем как есть — иначе триггер выглядел бы пустым при реально активном фильтре.
  const selectedLabel = value ? (options.find((o) => o.value === value)?.label ?? value) : null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none h-8 dark:bg-input/30 dark:hover:bg-input/50"
      >
        <span className={cn('truncate text-left', !selectedLabel && 'text-muted-foreground')}>{selectedLabel ?? placeholder}</span>
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
            <button
              type="button"
              onClick={() => pick(undefined)}
              className={cn(
                'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                !value && 'font-medium',
              )}
            >
              {emptyLabel}
            </button>
            {visible.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Ничего не найдено</div>}
            {visible.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => pick(o.value)}
                className={cn(
                  'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                  value === o.value && 'bg-accent/60 font-medium',
                )}
              >
                <span className="truncate">{o.label}</span>
              </button>
            ))}
            {filtered.length > MAX_VISIBLE_OPTIONS && (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                Показаны первые {MAX_VISIBLE_OPTIONS} из {filtered.length} — уточните запрос
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
