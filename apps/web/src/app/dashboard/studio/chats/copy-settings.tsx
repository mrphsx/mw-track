'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowDown } from 'lucide-react';
import { ChatAccessData, ChatProject, copyChatSettings, fetchChatAccess } from '@/lib/chat';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';

// Перенос настроек чата между ресурсами (2026-10-25: «добавь возможность передать настройки чата
// между проектами (ресурсами)»): из текущего проекта/канала в другой или наоборот. Теги и поля
// сопоставляются по названию, этапы и шаблоны добавляются, если таких ещё нет.

type Resource = ChatAccessData['resources'][number];

const PARTS = [
  { id: 'tags', label: 'Теги' },
  { id: 'fields', label: 'Поля' },
  { id: 'stages', label: 'Этапы' },
  { id: 'templates', label: 'Шаблоны' },
  { id: 'distribution', label: 'Операторы и доли' },
] as const;
type PartId = (typeof PARTS)[number]['id'];

const SELECT =
  'h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30';

function resourceLabel(r: Resource) {
  return r.kind === 'PERSONAL' ? 'Личка' : r.kind === 'EXTRA_BOT' ? `${r.title} (доп. бот)` : 'Бот';
}

export function CopySettingsDialog({
  projects,
  projectId,
  resource,
  resources,
  onClose,
}: {
  projects: ChatProject[];
  projectId: string;
  resource: string;
  resources: Resource[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [otherProjectId, setOtherProjectId] = useState(projectId);
  const [otherResource, setOtherResource] = useState('');
  const [parts, setParts] = useState<Record<PartId, boolean>>({ tags: true, fields: true, stages: true, templates: true, distribution: false });
  const [error, setError] = useState('');
  const [result, setResult] = useState<Record<PartId, number> | null>(null);

  const { data: otherAccess } = useQuery({
    queryKey: ['chat-access', otherProjectId],
    queryFn: () => fetchChatAccess(otherProjectId),
  });
  const otherResources = (otherAccess?.resources ?? []).filter((r) => !(otherProjectId === projectId && r.key === resource));
  useEffect(() => {
    if (otherAccess && !otherResources.some((r) => r.key === otherResource)) setOtherResource(otherResources[0]?.key ?? '');
  }, [otherAccess, otherResources, otherResource]);

  const current = resources.find((r) => r.key === resource);
  const currentName = projects.find((p) => p.id === projectId)?.name ?? 'Проект';

  const copy = useMutation({
    mutationFn: () => {
      const here = { projectId, resource };
      const there = { projectId: otherProjectId, resource: otherResource };
      const [from, to] = direction === 'out' ? [here, there] : [there, here];
      return copyChatSettings({ fromProjectId: from.projectId, fromResource: from.resource, toProjectId: to.projectId, toResource: to.resource, ...parts });
    },
    onSuccess: (r) => {
      setResult(r);
      setError('');
      for (const key of ['chat-tags', 'chat-fields', 'chat-stages', 'chat-templates', 'chat-access']) queryClient.invalidateQueries({ queryKey: [key] });
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось перенести'),
  });

  const hereBlock = (
    <div className="rounded-lg border px-3 py-2 text-sm">
      <div className="font-medium truncate">{currentName}</div>
      <div className="text-xs text-muted-foreground">{current ? resourceLabel(current) : resource === 'PERSONAL' ? 'Личка' : 'Бот'} · открыт сейчас</div>
    </div>
  );
  const thereBlock = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <select className={SELECT} value={otherProjectId} onChange={(e) => setOtherProjectId(e.target.value)}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select className={SELECT} value={otherResource} onChange={(e) => setOtherResource(e.target.value)} disabled={!otherResources.length}>
        {!otherResources.length && <option value="">{otherAccess ? 'Нет другого канала' : 'Загрузка…'}</option>}
        {otherResources.map((r) => (
          <option key={r.key} value={r.key}>
            {resourceLabel(r)}
          </option>
        ))}
      </select>
    </div>
  );

  const anyPart = Object.values(parts).some(Boolean);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Перенести настройки чата</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="inline-flex rounded-lg bg-muted p-1 gap-0.5">
            {(
              [
                ['out', 'Отсюда в другой'],
                ['in', 'Из другого сюда'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setDirection(id)}
                className={
                  direction === id ? 'px-3 py-1.5 rounded-md text-sm font-medium bg-background shadow-sm' : 'px-3 py-1.5 rounded-md text-sm text-muted-foreground'
                }
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Откуда</div>
            {direction === 'out' ? hereBlock : thereBlock}
            <div className="flex justify-center text-muted-foreground">
              <ArrowDown className="w-4 h-4" />
            </div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Куда</div>
            {direction === 'out' ? thereBlock : hereBlock}
          </div>

          <div className="space-y-2">
            {PARTS.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={parts[p.id]} onCheckedChange={(v) => setParts((prev) => ({ ...prev, [p.id]: !!v }))} />
                {p.label}
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              Ничего не удаляется: теги, поля и папки с тем же названием переиспользуются, этапы и ответы с тем же названием пропускаются. «Операторы
              и доли» заменяют авто-распределение канала назначения и операторов этапов; недостающие операторы добавятся в проект.
            </p>
          </div>

          {result && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              Перенесено: тегов {result.tags}, полей {result.fields}, этапов {result.stages}, шаблонов {result.templates}
              {parts.distribution ? `, долей операторов ${result.distribution}` : ''}.
            </p>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Закрыть
            </Button>
            <Button disabled={!anyPart || !otherResource || copy.isPending} onClick={() => copy.mutate()}>
              {copy.isPending ? 'Переносим…' : 'Перенести'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
