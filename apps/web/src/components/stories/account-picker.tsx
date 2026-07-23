'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface EligibleProject {
  id: string;
  name: string;
  tgPersonalUsername: string | null;
}

export interface StoriesOverview {
  connectedProjects: EligibleProject[];
  eligibleUnconnectedProjects: EligibleProject[];
  hasAnyTelegramProject: boolean;
}

export function useStoriesOverview() {
  return useQuery({
    queryKey: ['stories-overview'],
    queryFn: async () => (await api.get<StoriesOverview>('/stories/overview')).data,
  });
}

export function accountLabel(p: EligibleProject): string {
  return `${p.name}${p.tgPersonalUsername ? ` (@${p.tgPersonalUsername})` : ''}`;
}

// Всегда видимый выбор аккаунта (запрос пользователя 2026-07-21: "куда грузится история, я
// просто не вижу выбора проекта") — раньше показывался только при >1 подключённом аккаунте,
// из-за чего с одним аккаунтом было совсем непонятно, куда уйдёт публикация. Теперь виден
// всегда, когда есть хотя бы один подключённый аккаунт, даже единственный.
export function AccountPicker({
  projects,
  value,
  onChange,
}: {
  projects: EligibleProject[];
  value: string;
  onChange: (projectId: string) => void;
}) {
  if (projects.length === 0) return null;

  return (
    <div className="max-w-sm space-y-1.5">
      <Label>Аккаунт</Label>
      <Select value={value} onValueChange={(v) => onChange(v ?? '')}>
        <SelectTrigger className="w-full">
          <SelectValue>
            {() => {
              const p = projects.find((pr) => pr.id === value);
              return p ? accountLabel(p) : '';
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {accountLabel(p)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
