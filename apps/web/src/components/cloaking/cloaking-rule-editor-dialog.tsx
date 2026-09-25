'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CLOAKING_ACTION_LABELS,
  CloakingActionType,
  CloakingConditionState,
  CloakingRuleApiShape,
  CloakingRuleMatchLogic,
  emptyConfigForField,
} from './cloaking-types';
import { CloakingConditionRow } from './cloaking-condition-row';

const ACTION_ORDER: CloakingActionType[] = ['ALLOW', 'REDIRECT', 'PRELANDING', 'NOT_FOUND', 'BLANK', 'CUSTOM_HTML', 'CUSTOM_TEXT'];

export interface CloakingRuleFormPayload {
  name: string;
  matchLogic: CloakingRuleMatchLogic;
  action: CloakingActionType;
  actionRedirectUrl: string;
  actionCustomHtml: string;
  actionCustomText: string;
  conditions: { field: CloakingConditionState['field']; negate: boolean; config: Record<string, unknown> }[];
}

function newClientId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
}

export function CloakingRuleEditorDialog({
  rule,
  hasPrelandingUploaded,
  onClose,
  onSave,
  saving,
  error,
}: {
  // null — создание нового правила
  rule: CloakingRuleApiShape | null;
  hasPrelandingUploaded: boolean;
  onClose: () => void;
  onSave: (payload: CloakingRuleFormPayload) => void;
  saving: boolean;
  error: string;
}) {
  const [name, setName] = useState(rule?.name ?? '');
  const [matchLogic, setMatchLogic] = useState<CloakingRuleMatchLogic>(rule?.matchLogic ?? 'AND');
  const [action, setAction] = useState<CloakingActionType>(rule?.action ?? 'REDIRECT');
  const [actionRedirectUrl, setActionRedirectUrl] = useState(rule?.actionRedirectUrl ?? '');
  const [actionCustomHtml, setActionCustomHtml] = useState(rule?.actionCustomHtml ?? '');
  const [actionCustomText, setActionCustomText] = useState(rule?.actionCustomText ?? '');
  const [conditions, setConditions] = useState<CloakingConditionState[]>(
    () => rule?.conditions.map((c) => ({ clientId: newClientId(), field: c.field, negate: c.negate, config: c.config })) ?? [],
  );

  const addCondition = () => setConditions((prev) => [...prev, { clientId: newClientId(), field: 'COUNTRY', negate: false, config: emptyConfigForField('COUNTRY') }]);
  const updateCondition = (clientId: string, next: CloakingConditionState) => setConditions((prev) => prev.map((c) => (c.clientId === clientId ? next : c)));
  const removeCondition = (clientId: string) => setConditions((prev) => prev.filter((c) => c.clientId !== clientId));

  const submit = () => {
    onSave({
      name,
      matchLogic,
      action,
      actionRedirectUrl,
      actionCustomHtml,
      actionCustomText,
      conditions: conditions.map(({ field, negate, config }) => ({ field, negate, config })),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? 'Изменить правило' : 'Новое правило клоакинга'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Название (необязательно)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: блок ботов" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Условия (пусто = правило срабатывает всегда)</Label>
              {conditions.length > 1 && (
                <Select value={matchLogic} onValueChange={(v) => setMatchLogic(v as CloakingRuleMatchLogic)}>
                  <SelectTrigger className="w-28">
                    <SelectValue>{(v: CloakingRuleMatchLogic) => (v === 'AND' ? 'И (AND)' : 'ИЛИ (OR)')}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-max min-w-(--anchor-width)">
                    <SelectItem value="AND">И (AND)</SelectItem>
                    <SelectItem value="OR">ИЛИ (OR)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              {conditions.map((c) => (
                <CloakingConditionRow key={c.clientId} condition={c} onChange={(next) => updateCondition(c.clientId, next)} onRemove={() => removeCondition(c.clientId)} />
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addCondition}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Добавить условие
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Действие при совпадении</Label>
            <Select value={action} onValueChange={(v) => setAction(v as CloakingActionType)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: CloakingActionType) => CLOAKING_ACTION_LABELS[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent className="w-max min-w-(--anchor-width) max-w-[26rem]">
                {ACTION_ORDER.map((a) => (
                  <SelectItem key={a} value={a}>
                    {CLOAKING_ACTION_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {action === 'REDIRECT' && (
              <div className="space-y-1">
                <Input value={actionRedirectUrl} onChange={(e) => setActionRedirectUrl(e.target.value)} placeholder="https://en.wikipedia.org" />
                <p className="text-xs text-muted-foreground">Если оставить пустым — используется Wikipedia по умолчанию.</p>
              </div>
            )}
            {action === 'PRELANDING' && !hasPrelandingUploaded && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                White-страница ещё не загружена — пока не загрузите её выше, будет использоваться редирект-фолбэк (см. ссылку ниже).
              </p>
            )}
            {action === 'PRELANDING' && (
              <div className="space-y-1">
                <Input value={actionRedirectUrl} onChange={(e) => setActionRedirectUrl(e.target.value)} placeholder="Резервная ссылка: https://en.wikipedia.org" />
              </div>
            )}
            {action === 'CUSTOM_HTML' && <Textarea rows={6} className="font-mono text-xs" value={actionCustomHtml} onChange={(e) => setActionCustomHtml(e.target.value)} placeholder="<h1>...</h1>" />}
            {action === 'CUSTOM_TEXT' && <Textarea rows={4} value={actionCustomText} onChange={(e) => setActionCustomText(e.target.value)} placeholder="Текст для посетителя" />}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Сохраняем...' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
