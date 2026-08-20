'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PersonalBroadcastsList } from '../personal-broadcasts-list';
import { StudioPill } from '../ui';

interface ProjectSummary {
  id: string;
  name: string;
}

// Studio-версия — та же логика, что и classic (dashboard)/my-personal-broadcasts, см. её для
// полного комментария (запрос пользователя 2026-08-14). Здесь только Studio-оформление, тот же
// пикер-паттерн, что studio/my-clients.
export default function StudioMyPersonalBroadcastsPage() {
  const [projectId, setProjectId] = useState<string | null>(null);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });

  if (!projectId && projects?.length) {
    setProjectId(projects[0].id);
  }

  return (
    <div className="space-y-4">
      {projects && projects.length > 1 && (
        <div className="flex items-center justify-end">
          <Select value={projectId ?? undefined} onValueChange={setProjectId}>
            <SelectTrigger className="w-56 rounded-lg">
              {/* Base UI Select.Value без children рендерит сырой value (id), не текст пункта —
                  тот же баг, что уже встречался в studio/my-clients и т.д. */}
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
          <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Доступные проекты:</span>
          {projects.map((p) => (
            <StudioPill key={p.id} hue={p.id === projectId ? 'amber' : undefined}>
              {p.name}
            </StudioPill>
          ))}
        </div>
      )}

      {projectId && (
        <PersonalBroadcastsList projectId={projectId} newHref={`/my-personal-broadcasts/new?projectId=${projectId}`} />
      )}

      {projects && projects.length === 0 && (
        <div className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">У вас пока нет доступа ни к одному проекту.</div>
      )}
    </div>
  );
}
