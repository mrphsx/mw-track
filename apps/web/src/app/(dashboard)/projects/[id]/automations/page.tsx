'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Plus, Workflow } from 'lucide-react';
import { api } from '@/lib/api';
import { AUTOMATION_TRIGGER_EVENTS, AutomationFlowListItem, TRIGGER_LABEL } from '@/lib/automations';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';

// Автоворонки (Drip Campaigns, Фаза 3.1, запрос пользователя 2026-07-15) — список воронок
// проекта. Создание воронки — только имя + триггер, шаги добавляются уже в редакторе
// (/automations/[flowId]), по тому же принципу, что и лендинг создаётся сначала пустым.
export default function AutomationsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [triggerEvent, setTriggerEvent] = useState<(typeof AUTOMATION_TRIGGER_EVENTS)[number]>('Subscribe');
  const [error, setError] = useState('');

  const { data: flows, isLoading } = useQuery({
    queryKey: ['project', projectId, 'automations'],
    queryFn: async () => (await api.get<AutomationFlowListItem[]>(`/projects/${projectId}/automations`)).data,
  });

  const create = useMutation({
    mutationFn: async () => (await api.post(`/projects/${projectId}/automations`, { name, triggerEvent })).data as { id: string },
    onSuccess: (flow) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'automations'] });
      router.push(`/projects/${projectId}/automations/${flow.id}`);
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать воронку'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ flowId, isActive }: { flowId: string; isActive: boolean }) =>
      api.patch(`/projects/${projectId}/automations/${flowId}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId, 'automations'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Автоворонки</h1>
          <p className="text-sm text-gray-500">Автоматические цепочки: событие → задержка → сообщение → условие.</p>
        </div>
        {hasPermission(user, 'AUTOMATIONS_CREATE') && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Создать воронку
          </Button>
        )}
      </div>

      {isLoading && <p className="text-sm text-gray-500">Загрузка...</p>}

      {!isLoading && flows?.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">Воронок пока нет.</CardContent>
        </Card>
      )}

      {!!flows?.length && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {flows.map((flow) => (
            <Card
              key={flow.id}
              onClick={() => router.push(`/projects/${projectId}/automations/${flow.id}`)}
              className="cursor-pointer transition-colors hover:ring-foreground/20"
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Workflow className="w-4 h-4 shrink-0 text-gray-400" />
                    <p className="font-medium truncate">{flow.name}</p>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={flow.isActive}
                      onCheckedChange={(checked) => toggleActive.mutate({ flowId: flow.id, isActive: checked })}
                    />
                  </div>
                </div>
                <Badge variant="outline">{TRIGGER_LABEL[flow.triggerEvent as keyof typeof TRIGGER_LABEL] || flow.triggerEvent}</Badge>
                <div className="flex items-center gap-3 text-sm text-gray-500">
                  <span>{flow.stepCount} {flow.stepCount === 1 ? 'шаг' : 'шагов'}</span>
                  <span>{flow.activeEnrollments} в процессе</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={(open) => !open && setShowCreate(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Новая воронка</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="flow-name">Название</Label>
              <Input id="flow-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="flow-trigger">Запускается, когда клиент</Label>
              <Select value={triggerEvent} onValueChange={(v) => v && setTriggerEvent(v as typeof triggerEvent)}>
                <SelectTrigger id="flow-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTOMATION_TRIGGER_EVENTS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TRIGGER_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button onClick={() => create.mutate()} disabled={!name || create.isPending}>
              {create.isPending ? 'Создаём...' : 'Создать и настроить шаги'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
