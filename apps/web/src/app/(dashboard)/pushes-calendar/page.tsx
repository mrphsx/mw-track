'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { CalendarGrid } from '@/components/pushes/calendar-grid';
import { DayScheduleList, DayScheduleItem } from '@/components/pushes/day-schedule-list';

// Календарь рассылок по всей компании сразу (запрос пользователя 2026-07-19, "так же можно и
// глобальный календарь такой под все проекты") — та же CalendarGrid/DayScheduleList, что и
// внутрипроектный календарь на странице создания рассылки, только источник данных —
// company-wide эндпоинты (/pushes/scheduled-summary, /pushes/scheduled-day), видимость которых
// на бэкенде уже ограничена доступными пользователю проектами (Buyer/Operator видят только
// свои назначенные, см. ProjectsService.getAccessibleProjectIds). Только просмотр — создание
// рассылки по-прежнему со страницы конкретного проекта, тут нет formы создания.
export default function PushesCalendarPage() {
  const [visibleMonth, setVisibleMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());

  const monthKey = format(visibleMonth, 'yyyy-MM');
  const { data: summary } = useQuery({
    queryKey: ['pushes-global-scheduled-summary', monthKey],
    queryFn: async () => (await api.get<{ date: string; count: number }[]>('/pushes/scheduled-summary', { params: { month: monthKey } })).data,
  });
  const counts = new Map((summary ?? []).map((s) => [s.date, s.count]));

  const dateKey = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
  const { data: dayItems, isFetching: dayLoading } = useQuery({
    queryKey: ['pushes-global-scheduled-day', dateKey],
    queryFn: async () => (await api.get<DayScheduleItem[]>('/pushes/scheduled-day', { params: { date: dateKey } })).data,
    enabled: !!dateKey,
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CalendarDays className="h-6 w-6" /> Календарь рассылок
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Все запланированные рассылки по всем проектам сразу</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-start gap-6 p-6">
          <CalendarGrid
            visibleMonth={visibleMonth}
            onMonthChange={setVisibleMonth}
            counts={counts}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
          <DayScheduleList date={selectedDate} items={dayItems} isLoading={dayLoading} showProject />
        </CardContent>
      </Card>
    </div>
  );
}
