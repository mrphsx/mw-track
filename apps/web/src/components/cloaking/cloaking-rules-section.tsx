'use client';

// Секция "Правила" на странице клоакинга лендинга (запрос пользователя 2026-09-24, движок
// правил "до уровня Keitaro") — самодостаточный компонент со своими запросами/мутациями, тот
// же принцип, что уже у CloakingPrelandingUpload: монтируется одинаково в обоих деревьях без
// дублирования логики в каждом page.tsx.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { CloakingRuleApiShape } from './cloaking-types';
import { CloakingRuleCard } from './cloaking-rule-card';
import { CloakingRuleEditorDialog, CloakingRuleFormPayload } from './cloaking-rule-editor-dialog';

export function CloakingRulesSection({ landingId, hasPrelandingUploaded }: { landingId: string; hasPrelandingUploaded: boolean }) {
  const queryClient = useQueryClient();
  const queryKey = ['landing', landingId, 'cloaking-rules'];
  const [editing, setEditing] = useState<{ rule: CloakingRuleApiShape | null } | null>(null);
  const [error, setError] = useState('');

  const { data: rules } = useQuery({
    queryKey,
    queryFn: async () => (await api.get<CloakingRuleApiShape[]>(`/landings/${landingId}/cloaking/rules`)).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const createMutation = useMutation({
    mutationFn: async (payload: CloakingRuleFormPayload) => api.post(`/landings/${landingId}/cloaking/rules`, payload),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить правило'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ ruleId, payload }: { ruleId: string; payload: Partial<CloakingRuleFormPayload> }) =>
      api.patch(`/landings/${landingId}/cloaking/rules/${ruleId}`, payload),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить правило'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ruleId: string) => api.delete(`/landings/${landingId}/cloaking/rules/${ruleId}`),
    onSuccess: invalidate,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ ruleId, isEnabled }: { ruleId: string; isEnabled: boolean }) => api.patch(`/landings/${landingId}/cloaking/rules/${ruleId}`, { isEnabled }),
    onSuccess: invalidate,
  });

  const reorderMutation = useMutation({
    mutationFn: async (ruleIds: string[]) => api.patch(`/landings/${landingId}/cloaking/rules/reorder`, { ruleIds }),
    onSuccess: invalidate,
  });

  const move = (index: number, direction: -1 | 1) => {
    if (!rules) return;
    const next = [...rules];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorderMutation.mutate(next.map((r) => r.id));
  };

  const savePending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Правила</p>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing({ rule: null })}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Добавить правило
        </Button>
      </div>

      {rules && rules.length === 0 && <p className="text-xs text-muted-foreground">Правил пока нет — без них клоакинг ничего не блокирует.</p>}

      <div className="space-y-2">
        {rules?.map((rule, index) => (
          <CloakingRuleCard
            key={rule.id}
            rule={rule}
            isFirst={index === 0}
            isLast={index === (rules.length - 1)}
            onToggleEnabled={(isEnabled) => toggleMutation.mutate({ ruleId: rule.id, isEnabled })}
            onEdit={() => setEditing({ rule })}
            onDelete={() => deleteMutation.mutate(rule.id)}
            onMoveUp={() => move(index, -1)}
            onMoveDown={() => move(index, 1)}
          />
        ))}
      </div>

      {editing && (
        <CloakingRuleEditorDialog
          rule={editing.rule}
          hasPrelandingUploaded={hasPrelandingUploaded}
          saving={savePending}
          error={error}
          onClose={() => {
            setEditing(null);
            setError('');
          }}
          onSave={(payload) => {
            if (editing.rule) updateMutation.mutate({ ruleId: editing.rule.id, payload });
            else createMutation.mutate(payload);
          }}
        />
      )}
    </div>
  );
}
