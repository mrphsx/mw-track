'use client';

import { Rocket, X } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CLOAKING_FIELD_LABELS,
  CloakingConditionField,
  CloakingConditionState,
  PAID_CLOAKING_FIELDS,
  TRIAL_ALLOWED_CLOAKING_FIELDS,
  emptyConfigForField,
} from './cloaking-types';
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
  // На TRIAL доступна только "Страна" (запрос пользователя 2026-09-25) — остальные условия
  // задизейблены с тем же значком, что у тарифа Starter на странице подписки (Rocket), которым
  // они и открываются. Platform-owned/paid-tier поля (PAID_CLOAKING_FIELDS) — отдельная причина
  // блокировки ("Скоро", ещё не реализовано вообще, для любого тарифа), приоритет отдаётся ей,
  // если оба условия почему-то совпали.
  const plan = useAuthStore((s) => s.user?.company?.plan);
  const isTrial = plan === 'TRIAL';

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
              const isTrialLocked = !isPaid && isTrial && !TRIAL_ALLOWED_CLOAKING_FIELDS.includes(field);
              return (
                <SelectItem key={field} value={field} disabled={isPaid || isTrialLocked}>
                  <span className="flex items-center gap-1.5">
                    {CLOAKING_FIELD_LABELS[field]}
                    {isPaid && <span className="text-[10px] rounded bg-muted px-1 py-0.5 text-muted-foreground">Скоро</span>}
                    {isTrialLocked && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[10px] rounded bg-muted px-1 py-0.5 text-muted-foreground"
                        title="Доступно с тарифа Starter"
                      >
                        <Rocket className="w-2.5 h-2.5" /> Starter
                      </span>
                    )}
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
