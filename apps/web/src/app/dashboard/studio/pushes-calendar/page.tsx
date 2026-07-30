'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import { api } from '@/lib/api';
import { CalendarGrid } from '@/components/pushes/calendar-grid';
import { DayScheduleList, DayScheduleItem } from '@/components/pushes/day-schedule-list';
import { STUDIO_CARD } from '../ui';

// Studio-версия общекомпанейского календаря рассылок (запрос пользователя 2026-07-30: "готовить
// все остальные страницы") — логика 1:1 с классической (apps/web/.../(dashboard)/pushes-calendar/
// page.tsx). CalendarGrid/DayScheduleList переиспользованы без изменений (сложные
// самодостаточные виджеты — тот же принцип, что и у ClientsFilter/LandingCard/диалогов).
export default function StudioPushesCalendarPage() {
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
        <h1 className="flex items-center gap-2 text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">
          <CalendarDays className="h-6 w-6" /> Календарь рассылок
        </h1>
        <p className="mt-1.5 text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Все запланированные рассылки по всем проектам сразу</p>
      </div>

      <div className={`${STUDIO_CARD} flex flex-wrap items-start gap-6 p-6`}>
        <CalendarGrid
          visibleMonth={visibleMonth}
          onMonthChange={setVisibleMonth}
          counts={counts}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
        <DayScheduleList date={selectedDate} items={dayItems} isLoading={dayLoading} showProject />
      </div>
    </div>
  );
}
