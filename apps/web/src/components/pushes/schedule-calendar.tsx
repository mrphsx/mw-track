'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { CalendarGrid } from './calendar-grid';
import { DayScheduleList, DayScheduleItem } from './day-schedule-list';

interface ScheduleCalendarProps {
  projectId: string;
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
}

// Календарь распределения рассылок ВНУТРИ одного проекта (запрос пользователя 2026-07-18,
// "удобное распределение рассылок... можно даже в виде календаря") — свой компонент без новых
// npm-зависимостей: в репозитории нет ни одной calendar/date-picker библиотеки, тянуть её ради
// одной фичи не стали (см. план). Сетка вынесена в общий CalendarGrid (переиспользуется и
// глобальным календарём под все проекты, pushes-calendar/page.tsx) — здесь только источник
// данных: {дата, количество} за видимый месяц + список рассылок на выбранный день, оба всегда
// project-scoped и ограничены минимальным объёмом (один месяц/один день), перезапрашиваются
// только при смене месяца/дня, не при каждом рендере.
export function ScheduleCalendar({ projectId, selectedDate, onSelectDate }: ScheduleCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => selectedDate ?? new Date());

  const monthKey = format(visibleMonth, 'yyyy-MM');
  const { data: summary } = useQuery({
    queryKey: ['pushes-scheduled-summary', projectId, monthKey],
    queryFn: async () =>
      (await api.get<{ date: string; count: number }[]>(`/projects/${projectId}/pushes/stats/scheduled-summary`, { params: { month: monthKey } })).data,
  });
  const counts = new Map((summary ?? []).map((s) => [s.date, s.count]));

  const dateKey = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
  const { data: dayItems, isFetching: dayLoading } = useQuery({
    queryKey: ['pushes-scheduled-day', projectId, dateKey],
    queryFn: async () =>
      (await api.get<DayScheduleItem[]>(`/projects/${projectId}/pushes/stats/scheduled-day`, { params: { date: dateKey } })).data,
    enabled: !!dateKey,
  });

  return (
    // Календарь сверху во всю ширину, список дня — под ним (запрос пользователя 2026-08-05:
    // "растяни сам календарь на всю ширину своей карточки") — раньше стояли рядом (flex-row),
    // из-за чего календарь держался у фиксированной компактной ширины независимо от того,
    // насколько широка сама карточка "Расписание" в композере.
    <div className="space-y-4">
      <div className="rounded-lg border p-3">
        <CalendarGrid
          compact
          visibleMonth={visibleMonth}
          onMonthChange={setVisibleMonth}
          counts={counts}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
        />
      </div>
      <DayScheduleList date={selectedDate} items={dayItems} isLoading={dayLoading} showProject={false} />
    </div>
  );
}
