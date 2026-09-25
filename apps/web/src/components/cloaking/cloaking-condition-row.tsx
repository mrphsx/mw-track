'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CLOAKING_FIELD_LABELS, CloakingConditionField, CloakingConditionState, PAID_CLOAKING_FIELDS, emptyConfigForField } from './cloaking-types';
import { ConditionConfigEditor } from './condition-config-editor';

const FIELD_ORDER: CloakingConditionField[] = [
  'COUNTRY', 'REGION', 'CITY', 'IP', 'REFERRER', 'USER_AGENT', 'X_REQUESTED_WITH', 'LANGUAGE',
  'BROWSER', 'BROWSER_VERSION', 'OS', 'OS_VERSION', 'DEVICE_TYPE', 'DEVICE_MODEL', 'PARAMETER',
  'DATE_BETWEEN', 'TIMETABLE', 'LIMIT_CLICKS', 'BOT', 'UNIQUENESS',
  'PROXY', 'ISP', 'MOBILE_OPERATOR', 'CONNECTION_TYPE',
];

export function CloakingConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: CloakingConditionState;
  onChange: (next: CloakingConditionState) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <Select
          value={condition.field}
          onValueChange={(field) => onChange({ ...condition, field: field as CloakingConditionField, config: emptyConfigForField(field as CloakingConditionField) })}
        >
          <SelectTrigger className="flex-1">
            {/* Без children-функции Base UI показывает сырое value (COUNTRY, IP, ...), а не
                русскую подпись — тот же повторяющийся баг, что уже чинился в проекте несколько
                раз (см. get-link-dialog.tsx). */}
            <SelectValue>{(v: CloakingConditionField) => CLOAKING_FIELD_LABELS[v]}</SelectValue>
          </SelectTrigger>
          <SelectContent className="w-max min-w-(--anchor-width) max-w-[26rem]">
            {FIELD_ORDER.map((field) => {
              const isPaid = PAID_CLOAKING_FIELDS.includes(field);
              return (
                <SelectItem key={field} value={field} disabled={isPaid}>
                  <span className="flex items-center gap-1.5">
                    {CLOAKING_FIELD_LABELS[field]}
                    {isPaid && <span className="text-[10px] rounded bg-muted px-1 py-0.5 text-muted-foreground">Скоро</span>}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap cursor-pointer">
          <Checkbox checked={condition.negate} onCheckedChange={(v) => onChange({ ...condition, negate: v === true })} />
          НЕ
        </label>
        <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <ConditionConfigEditor field={condition.field} config={condition.config} onChange={(config) => onChange({ ...condition, config })} />
    </div>
  );
}
