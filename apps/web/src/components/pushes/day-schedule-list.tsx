'use client';

import { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { CalendarClock } from 'lucide-react';
import { PushPreviewDialog } from './push-preview-dialog';

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
//
// Переделано в компактный вид (запрос пользователя 2026-08-18: "иногда их слишком много и не
// помещаются... проект (время1) (время2) (время3), в ряд") — раньше каждый пуш был отдельной
// строкой (имя + дата под ним), на день с несколькими рассылками в одном проекте список быстро
// раздувался по высоте. Теперь один ряд НА ПРОЕКТ: имя проекта слева, время каждой рассылки —
// компактная кликабельная плашка справа, все плашки одного проекта в одном flex-wrap ряду. Имя
// самой рассылки больше не показывается тут — вместо этого клик по плашке времени открывает
// PushPreviewDialog (тот же попап 2026-08-18, что и в списках рассылок), где видно и имя, и
// содержимое. При showProject=false (композер, всегда один проект в контексте) группировка не
// нужна — рендерится один ряд плашек без подписи проекта.
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
  const [previewPush, setPreviewPush] = useState<{ projectId: string; pushId: string } | null>(null);

  if (!date) return null;

  const groups: { projectId: string; projectName: string; items: DayScheduleItem[] }[] = [];
  for (const item of items ?? []) {
    let group = groups.find((g) => g.projectId === item.projectId);
    if (!group) {
      group = { projectId: item.projectId, projectName: item.projectName, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }

  return (
    <div className="min-w-[240px] flex-1 space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5" />
        {format(date, 'd MMMM', { locale: ru })}
        {!!items?.length && <span className="text-muted-foreground">· {items.length}</span>}
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Загрузка...</p>}
      {!isLoading && items?.length === 0 && <p className="text-xs text-muted-foreground">Ничего не запланировано</p>}

      <div className="space-y-2">
        {groups.map((group) => (
          <div key={group.projectId} className="flex flex-wrap items-center gap-1.5">
            {showProject && (
              <Link
                href={`/projects/${group.projectId}/pushes`}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 text-xs font-medium text-blue-600 hover:underline"
              >
                {group.projectName}
              </Link>
            )}
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPreviewPush({ projectId: item.projectId, pushId: item.id })}
                className="shrink-0 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground hover:border-blue-600 hover:text-blue-600 transition-colors"
              >
                {format(new Date(item.scheduledAt), 'HH:mm')}
              </button>
            ))}
          </div>
        ))}
      </div>

      {previewPush && (
        <PushPreviewDialog key={previewPush.pushId} projectId={previewPush.projectId} pushId={previewPush.pushId} onClose={() => setPreviewPush(null)} />
      )}
    </div>
  );
}
