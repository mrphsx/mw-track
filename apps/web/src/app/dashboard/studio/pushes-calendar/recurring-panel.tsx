'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Repeat, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Switch } from '@/components/ui/switch';
import { STUDIO_CARD } from '../ui';

// Регулярные рассылки по расписанию (2026-11-05): видно, что идёт по расписанию, и выключается
// одним переключателем — сразу для всех проектов серии (их может быть очень много). Отдельный
// проект можно убрать из серии крестиком.

export interface RecurringRow {
  id: string;
  name: string;
  messageText: string;
  days: { day: number; time: string }[];
  timezone: string;
  isActive: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunError: string | null;
  runCount: number;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  projects: { id: string; name: string; archived: boolean }[];
  hiddenProjects: number;
  canEdit: boolean;
}

const DAY_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const PROJECTS_PREVIEW = 4;

export function scheduleLabel(days: RecurringRow['days']) {
  return [...days].sort((a, b) => a.day - b.day).map((d) => `${DAY_SHORT[d.day]} ${d.time}`);
}

export function RecurringPushesPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['pushes-recurring'],
    queryFn: async () => (await api.get<RecurringRow[]>('/pushes/recurring')).data,
  });
  const [query, setQuery] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['pushes-recurring'] });
    setError('');
  };
  const onError = (err: unknown) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить');
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/pushes/recurring/${id}`, body),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/pushes/recurring/${id}`), onSuccess: refresh, onError });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter(
      (r) => (!onlyActive || r.isActive) && (!q || r.name.toLowerCase().includes(q) || r.projects.some((p) => p.name.toLowerCase().includes(q))),
    );
  }, [data, query, onlyActive]);
  const activeCount = (data ?? []).filter((r) => r.isActive).length;

  if (isLoading) return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка…</p>;
  if (!data?.length) {
    return (
      <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>
        Регулярных рассылок пока нет. Создайте рассылку и выберите «Регулярно по дням недели».
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по названию или проекту…"
          className="h-9 min-w-[220px] flex-1 rounded-lg bg-white dark:bg-[#171F2B] border border-[#DCE1E8] dark:border-white/10 px-2.5 text-sm text-[#131A24] dark:text-[#E9EDF3] outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-[#5F6B7A] dark:text-[#92A0AF] cursor-pointer">
          <Switch checked={onlyActive} onCheckedChange={setOnlyActive} /> Только включённые
        </label>
        <span className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
          Включено {activeCount} из {data.length}
        </span>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {rows.map((r) => {
        const open = expanded.has(r.id);
        const shown = open ? r.projects : r.projects.slice(0, PROJECTS_PREVIEW);
        return (
          <div key={r.id} className={`${STUDIO_CARD} p-4 space-y-3 ${r.isActive ? '' : 'opacity-70'}`}>
            <div className="flex items-start gap-3 flex-wrap">
              <Repeat className={`w-5 h-5 mt-0.5 shrink-0 ${r.isActive ? 'text-[#1F7A6C] dark:text-[#6FCBBA]' : 'text-[#5F6B7A]'}`} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-[#131A24] dark:text-[#E9EDF3] truncate">{r.name}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {scheduleLabel(r.days).map((d) => (
                    <span key={d} className="rounded-md bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/15 px-1.5 py-0.5 text-xs font-medium text-[#1F4E9C] dark:text-[#7BA9EE]">
                      {d}
                    </span>
                  ))}
                  <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] self-center">· {r.timezone}</span>
                </div>
              </div>
              {r.canEdit && (
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer shrink-0">
                  <Switch
                    checked={r.isActive}
                    disabled={patch.isPending}
                    onCheckedChange={(v) => patch.mutate({ id: r.id, body: { isActive: v } })}
                  />
                  <span className={r.isActive ? 'text-[#1F7A6C] dark:text-[#6FCBBA]' : 'text-[#5F6B7A] dark:text-[#92A0AF]'}>
                    {r.isActive ? 'Включена' : 'Выключена'}
                  </span>
                </label>
              )}
            </div>

            <div className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Следующая:{' '}
                <b className="text-[#131A24] dark:text-[#E9EDF3]">
                  {r.isActive && r.nextRunAt ? format(new Date(r.nextRunAt), 'EEEEEE, d MMM, HH:mm', { locale: ru }) : '— выключена'}
                </b>
              </span>
              <span>
                Отправок: <b className="text-[#131A24] dark:text-[#E9EDF3]">{r.runCount}</b>
                {r.lastRunAt && ` · последняя ${format(new Date(r.lastRunAt), 'd MMM, HH:mm', { locale: ru })}`}
              </span>
              {r.createdBy && <span>Создал: {r.createdBy.name}</span>}
            </div>
            {r.lastRunError && <p className="text-xs text-amber-700 dark:text-amber-400">{r.lastRunError}</p>}

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                Проекты ({r.projects.length + r.hiddenProjects}):
              </span>
              {shown.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-full border border-[#DCE1E8] dark:border-white/10 px-2 py-0.5 text-xs text-[#131A24] dark:text-[#E9EDF3]"
                >
                  {p.name}
                  {p.archived && <span className="text-[#5F6B7A]">(архив)</span>}
                  {r.canEdit && r.projects.length + r.hiddenProjects > 1 && (
                    <button
                      type="button"
                      title="Убрать проект из этой рассылки"
                      onClick={() =>
                        confirm(`Убрать «${p.name}» из рассылки «${r.name}»?`) &&
                        patch.mutate({ id: r.id, body: { projectIds: r.projects.filter((x) => x.id !== p.id).map((x) => x.id) } })
                      }
                      className="text-[#5F6B7A] hover:text-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
              {r.projects.length > PROJECTS_PREVIEW && (
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (open) next.delete(r.id);
                      else next.add(r.id);
                      return next;
                    })
                  }
                  className="text-xs font-medium text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline"
                >
                  {open ? 'Свернуть' : `+${r.projects.length - PROJECTS_PREVIEW} ещё`}
                </button>
              )}
              {r.hiddenProjects > 0 && <span className="text-xs text-[#5F6B7A]">+{r.hiddenProjects} без доступа</span>}
              {r.canEdit && (
                <button
                  type="button"
                  onClick={() => confirm(`Удалить регулярную рассылку «${r.name}»? Уже отправленные рассылки останутся в истории.`) && remove.mutate(r.id)}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-[#5F6B7A] dark:text-[#92A0AF] hover:text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Удалить
                </button>
              )}
            </div>
          </div>
        );
      })}
      {rows.length === 0 && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">По этому поиску ничего нет.</p>}
    </div>
  );
}
