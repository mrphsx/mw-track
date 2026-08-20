'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PersonalBroadcastsList } from '@/components/personal-broadcasts/broadcast-list';

interface ProjectSummary {
  id: string;
  name: string;
}

// Company-wide вход для Operator-а (запрос пользователя 2026-08-14: "точно такая же страница
// пушей и нового пуша, только для проектов которые ему доступны") — тот же пикер-паттерн, что
// /my-clients/my-stats (проект выбирается здесь, а не берётся из URL, т.к. у Operator может быть
// доступ сразу к нескольким проектам). GET /projects уже сам по себе scoped по ProjectAccess для
// не-elevated ролей — тот же список, что my-clients/my-stats используют без доп. фильтра.
// Содержимое ниже — ТОТ ЖЕ компонент PersonalBroadcastsList, что рендерится на project-scoped
// .../projects/[id]/personal-broadcasts, просто с projectId из локального состояния picker'а.
export default function MyPersonalBroadcastsPage() {
  const [projectId, setProjectId] = useState<string | null>(null);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });

  // Выбор проекта прямо во время рендера, не через useEffect (тот же приём, что my-clients —
  // useEffect применяется уже после первого коммита, дропдаун на мгновение показывал бы пустой
  // плейсхолдер вместо имени проекта).
  if (!projectId && projects?.length) {
    setProjectId(projects[0].id);
  }

  return (
    <div className="space-y-4">
      {projects && projects.length > 1 && (
        <div className="flex items-center justify-end">
          <Select value={projectId ?? undefined} onValueChange={setProjectId}>
            <SelectTrigger className="w-56">
              {/* Base UI Select.Value без children рендерит сырой value (id), не текст пункта —
                  тот же баг, что уже встречался в my-clients/my-stats/clients-filter и т.д. */}
              <SelectValue>{(v: string) => projects.find((p) => p.id === v)?.name ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {projects && projects.length > 0 && (
        <div className="flex items-center flex-wrap gap-2">
          <span className="text-xs text-muted-foreground">Доступные проекты:</span>
          {projects.map((p) => (
            <Badge key={p.id} variant={p.id === projectId ? 'default' : 'secondary'}>
              {p.name}
            </Badge>
          ))}
        </div>
      )}

      {projectId && (
        <PersonalBroadcastsList projectId={projectId} newHref={`/my-personal-broadcasts/new?projectId=${projectId}`} />
      )}

      {projects && projects.length === 0 && (
        <div className="border rounded-lg bg-card p-6 text-sm text-muted-foreground">
          У вас пока нет доступа ни к одному проекту.
        </div>
      )}
    </div>
  );
}
