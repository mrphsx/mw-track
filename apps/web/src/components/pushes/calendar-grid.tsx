'use client';

import { useMemo } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CalendarGridProps {
  visibleMonth: Date;
  onMonthChange: (date: Date) => void;
  // дата (yyyy-MM-dd) -> количество запланированных рассылок в этот день
  counts: Map<string, number>;
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  // компактный размер — для календаря на странице создания рассылки (в карточке рядом с
  // полями даты/времени); обычный — для отдельной страницы глобального календаря
  // (запрос пользователя 2026-07-19).
  compact?: boolean;
}

// Общая сетка месяца, переиспользуется и внутри-проектным (schedule-calendar.tsx), и
// глобальным (pushes-calendar/page.tsx) календарём — одна и та же вёрстка/стили в обоих
// местах, число рассылок показано прямо в ячейке (не только по наведению), запрос
// пользователя 2026-07-19 "видеть на когда уже есть рассылки и сколько".
export function CalendarGrid({ visibleMonth, onMonthChange, counts, selectedDate, onSelectDate, compact }: CalendarGridProps) {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [visibleMonth]);

  return (
    // compact — раньше фиксированная ширина 19rem (когда календарь стоял РЯДОМ со списком
    // рассылок дня, см. schedule-calendar.tsx); после того как ScheduleCalendar стал верстать
    // их друг под другом (запрос пользователя 2026-08-05: "растяни сам календарь на всю ширину
    // своей карточки"), фиксированная ширина держала сетку узкой посреди широкой карточки —
    // теперь w-full, растягивается на всю ширину родителя в обоих случаях.
    <div className={compact ? 'w-full' : 'w-full max-w-sm'}>
      <div className="flex items-center justify-between mb-2">
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onMonthChange(subMonths(visibleMonth, 1))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className={`font-medium capitalize ${compact ? 'text-sm' : 'text-base'}`}>{format(visibleMonth, 'LLLL yyyy', { locale: ru })}</div>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onMonthChange(addMonths(visibleMonth, 1))}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
          <div key={d} className="text-[11px] text-muted-foreground py-1">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const count = counts.get(key) ?? 0;
          const inMonth = isSameMonth(day, visibleMonth);
          const selected = selectedDate && isSameDay(day, selectedDate);
          return (
            <button
              type="button"
              key={key}
              onClick={() => onSelectDate(day)}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-md border border-transparent ${
                compact ? 'h-11' : 'h-14'
              } text-sm ${
                !inMonth ? 'text-muted-foreground' : selected ? 'bg-blue-600 text-white' : 'text-foreground hover:border-border hover:bg-muted'
              } ${isToday(day) && !selected ? 'font-bold text-blue-600' : ''}`}
            >
              <span>{format(day, 'd')}</span>
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[10px] leading-tight ${
                    selected ? 'bg-white text-blue-600' : 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
