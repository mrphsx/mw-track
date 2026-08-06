'use client';

import { ChevronDownIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface MultiSelectOption {
  value: string;
  label: string;
}

// Мульти-выбор (запрос пользователя 2026-08-03: "нету мультивыбора в фильтрах") — на базе уже
// существующих DropdownMenu/DropdownMenuCheckboxItem: MenuCheckboxItem.closeOnClick по умолчанию
// false в Base UI, поэтому меню само не закрывается после отметки пункта — ровно то поведение,
// которое нужно мульти-селекту, без обходных путей. Триггер стилизован под SelectTrigger, чтобы
// не выделяться среди соседних одиночных Select в том же фильтре.
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Все',
  className,
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const toggle = (v: string) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };

  const triggerLabel =
    value.length === 0 ? placeholder : value.length === 1 ? (options.find((o) => o.value === value[0])?.label ?? value[0]) : `Выбрано: ${value.length}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none h-8 dark:bg-input/30 dark:hover:bg-input/50',
          className,
        )}
      >
        <span className={cn('truncate', value.length === 0 && 'text-muted-foreground')}>{triggerLabel}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto min-w-(--anchor-width) max-w-[24rem]">
        {options.map((o) => (
          <DropdownMenuCheckboxItem key={o.value} checked={value.includes(o.value)} onCheckedChange={() => toggle(o.value)}>
            <span className="truncate">{o.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
