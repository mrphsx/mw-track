'use client';

import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CLOAKING_ACTION_LABELS, CLOAKING_FIELD_LABELS, CloakingRuleApiShape } from './cloaking-types';

function summarizeCondition(condition: CloakingRuleApiShape['conditions'][number]): string {
  const label = CLOAKING_FIELD_LABELS[condition.field];
  return condition.negate ? `НЕ ${label}` : label;
}

export function CloakingRuleCard({
  rule,
  isFirst,
  isLast,
  onToggleEnabled,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  rule: CloakingRuleApiShape;
  isFirst: boolean;
  isLast: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border p-3">
      <div className="flex flex-col gap-1 pt-0.5">
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={isFirst} onClick={onMoveUp}>
          <ArrowUp className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={isLast} onClick={onMoveDown}>
          <ArrowDown className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{rule.name || 'Без названия'}</span>
          {rule.conditions.length > 1 && (
            <Badge variant="outline" className="text-[10px]">
              {rule.matchLogic === 'AND' ? 'И' : 'ИЛИ'}
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">
            {CLOAKING_ACTION_LABELS[rule.action]}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1">
          {rule.conditions.length === 0 ? (
            <span className="text-xs text-muted-foreground">Срабатывает всегда (catch-all)</span>
          ) : (
            rule.conditions.map((c) => (
              <span key={c.id} className="text-xs rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                {summarizeCondition(c)}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Switch checked={rule.isEnabled} onCheckedChange={onToggleEnabled} />
        <Button type="button" variant="ghost" size="icon" onClick={onEdit}>
          <Pencil className="w-4 h-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" onClick={onDelete}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
