'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { CalendarClock } from 'lucide-react';

export interface DayScheduleItem {
  id: string;
  name: string;
  scheduledAt: string;
  projectId: string;
  projectName: string;
}

// Список самих рассылок на выбранный день (не только счётчик из CalendarGrid) — запрос
// пользователя 2026-07-19 "видеть на когда уже есть рассылки и сколько" буквально: счётчик в
// ячейке отвечает "сколько", этот список — "какие именно". showProject=true в глобальном
// календаре (несколько проектов сразу), false — во внутрипроектном (все элементы и так из
// одного проекта, имя было бы избыточным).
export function DayScheduleList({
  date,
  items,
  isLoading,
  showProject,
}: {
  date: Date | null;
  items: DayScheduleItem[] | undefined;
  isLoading: boolean;
  showProject: boolean;
}) {
  if (!date) return null;

  return (
    <div className="min-w-[240px] flex-1 space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex items-center gap-1.5 font-medium text-gray-600">
        <CalendarClock className="h-3.5 w-3.5" />
        {format(date, 'd MMMM', { locale: ru })}
        {!!items?.length && <span className="text-gray-400">· {items.length}</span>}
      </div>

      {isLoading && <p className="text-xs text-gray-400">Загрузка...</p>}
      {!isLoading && items?.length === 0 && <p className="text-xs text-gray-400">Ничего не запланировано</p>}

      <ul className="space-y-1.5">
        {items?.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 min-w-0">
            <div className="min-w-0">
              <div className="truncate font-medium">{item.name}</div>
              {showProject && (
                <Link href={`/projects/${item.projectId}/pushes`} className="block truncate text-xs text-blue-600 hover:underline">
                  {item.projectName}
                </Link>
              )}
            </div>
            <span className="shrink-0 text-xs text-gray-400">{format(new Date(item.scheduledAt), 'HH:mm')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
