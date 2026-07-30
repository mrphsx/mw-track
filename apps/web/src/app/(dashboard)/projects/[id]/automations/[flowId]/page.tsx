'use client';

// Редактор воронки — аккордеон шагов (тот же паттерн, что apps/web/src/components/
// bot-scenarios-tab.tsx: каждый шаг сам себя PATCHит/DELETEит, без общей кнопки "сохранить
// всё"). Без drag-and-drop (в проекте нет такой библиотеки, см. память проекта) — порядок
// шагов меняется стрелками вверх/вниз, каждая перестановка — отдельный запрос на бэкенд.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowDown, ArrowLeft, ArrowUp, Clock, GitBranch, Plus, Send, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import {
  AutomationButton,
  AutomationEnrollment,
  AutomationFlowDetail,
  AutomationStep,
  AutomationStepType,
  ENROLLMENT_STATUS_LABEL,
  TRIGGER_LABEL,
  clientDisplayName,
} from '@/lib/automations';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from '@/components/ui/accordion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Автоворонки временно отключены из UI (запрос пользователя 2026-07-22, см. заглушку в
// ../page.tsx) — прямой заход по URL тоже блокируется, раз кнопка со страницы проекта убрана.
function AutomationsDisabledNotice() {
  return (
    <Card>
      <CardContent className="p-8 text-center text-gray-500">Автоворонки временно недоступны.</CardContent>
    </Card>
  );
}

const STEP_TYPE_META: Record<AutomationStepType, { label: string; icon: typeof Clock }> = {
  DELAY: { label: 'Задержка', icon: Clock },
  SEND_PUSH: { label: 'Отправить сообщение', icon: Send },
  CONDITION: { label: 'Условие', icon: GitBranch },
};

function stepSummary(step: AutomationStep): string {
  if (step.type === 'DELAY') {
    const seconds = step.delaySeconds || 0;
    if (seconds % 86400 === 0 && seconds > 0) return `Подождать ${seconds / 86400} ${pluralDays(seconds / 86400)}`;
    if (seconds % 3600 === 0 && seconds > 0) return `Подождать ${seconds / 3600} ${pluralHours(seconds / 3600)}`;
    return `Подождать ${seconds} сек`;
  }
  if (step.type === 'SEND_PUSH') {
    const text = step.messageText || '';
    return text.length > 60 ? `${text.slice(0, 60)}…` : text || '(пусто)';
  }
  const hasPurchase = step.conditionFilter?.hasPurchase;
  if (hasPurchase == null) return 'Условие не настроено';
  return hasPurchase ? 'Если совершил покупку → иначе выход' : 'Если не совершил покупку → иначе выход';
}

function pluralDays(n: number): string {
  return n === 1 ? 'день' : n < 5 ? 'дня' : 'дней';
}
function pluralHours(n: number): string {
  return n === 1 ? 'час' : n < 5 ? 'часа' : 'часов';
}

export default function AutomationFlowEditorPage() {
  const { id: projectId, flowId } = useParams<{ id: string; flowId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: flow } = useQuery({
    queryKey: ['project', projectId, 'automations', flowId],
    queryFn: async () => (await api.get<AutomationFlowDetail>(`/projects/${projectId}/automations/${flowId}`)).data,
  });

  const { data: enrollments } = useQuery({
    queryKey: ['project', projectId, 'automations', flowId, 'enrollments'],
    queryFn: async () => (await api.get<AutomationEnrollment[]>(`/projects/${projectId}/automations/${flowId}/enrollments`)).data,
  });

  const [name, setName] = useState('');
  useEffect(() => setName(flow?.name || ''), [flow?.name]);

  const invalidateFlow = () => queryClient.invalidateQueries({ queryKey: ['project', projectId, 'automations', flowId] });
  const invalidateList = () => queryClient.invalidateQueries({ queryKey: ['project', projectId, 'automations'] });

  const saveName = useMutation({
    mutationFn: () => api.patch(`/projects/${projectId}/automations/${flowId}`, { name }),
    onSuccess: () => {
      invalidateFlow();
      invalidateList();
    },
  });

  const toggleActive = useMutation({
    mutationFn: (isActive: boolean) => api.patch(`/projects/${projectId}/automations/${flowId}`, { isActive }),
    onSuccess: () => {
      invalidateFlow();
      invalidateList();
    },
  });

  const removeFlow = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}/automations/${flowId}`),
    onSuccess: () => router.push(`/projects/${projectId}/automations`),
  });

  const addStep = useMutation({
    mutationFn: (type: AutomationStepType) =>
      api.post(`/projects/${projectId}/automations/${flowId}/steps`, defaultStepPayload(type)),
    onSuccess: invalidateFlow,
  });

  if (!flow) return <p className="text-sm text-gray-500">Загрузка...</p>;

  const automationsDisabled = true;
  if (automationsDisabled) return <AutomationsDisabledNotice />;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/automations`}
          className="text-sm text-gray-500 hover:underline inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Все воронки
        </Link>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            <Button size="sm" variant="outline" onClick={() => saveName.mutate()} disabled={!name || saveName.isPending}>
              Сохранить
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline">{TRIGGER_LABEL[flow.triggerEvent as keyof typeof TRIGGER_LABEL] || flow.triggerEvent}</Badge>
            <div className="flex items-center gap-1.5">
              <Label className="text-sm">Активна</Label>
              <Switch checked={flow.isActive} onCheckedChange={(checked) => toggleActive.mutate(checked)} />
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => confirm('Удалить воронку? Активные клиенты будут остановлены.') && removeFlow.mutate()}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {flow.steps.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">Шагов пока нет — добавьте первый ниже.</CardContent>
          </Card>
        ) : (
          <Accordion keepMounted>
            {flow.steps.map((step, i) => (
              <StepAccordionItem
                key={step.id}
                projectId={projectId}
                flowId={flowId}
                step={step}
                isFirst={i === 0}
                isLast={i === flow.steps.length - 1}
                onChanged={invalidateFlow}
              />
            ))}
          </Accordion>
        )}

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Добавить шаг:</span>
          {(Object.keys(STEP_TYPE_META) as AutomationStepType[]).map((type) => {
            const Icon = STEP_TYPE_META[type].icon;
            return (
              <Button key={type} size="sm" variant="outline" onClick={() => addStep.mutate(type)} disabled={addStep.isPending}>
                <Icon className="w-4 h-4 mr-1.5" /> {STEP_TYPE_META[type].label}
              </Button>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Клиенты в воронке</CardTitle>
        </CardHeader>
        <CardContent>
          {!enrollments?.length ? (
            <p className="text-sm text-gray-500">Пока никто не попал в эту воронку.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Вступил</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{clientDisplayName(e.client)}</TableCell>
                    <TableCell>
                      <Badge variant={e.status === 'ACTIVE' ? 'default' : e.status === 'FAILED' ? 'destructive' : 'secondary'}>
                        {ENROLLMENT_STATUS_LABEL[e.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-500">{new Date(e.enrolledAt).toLocaleString('ru-RU')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function defaultStepPayload(type: AutomationStepType) {
  if (type === 'DELAY') return { type, delaySeconds: 86400 };
  if (type === 'SEND_PUSH') return { type, messageText: '' };
  return { type, conditionFilter: { hasPurchase: false } };
}

function StepAccordionItem({
  projectId,
  flowId,
  step,
  isFirst,
  isLast,
  onChanged,
}: {
  projectId: string;
  flowId: string;
  step: AutomationStep;
  isFirst: boolean;
  isLast: boolean;
  onChanged: () => void;
}) {
  const Icon = STEP_TYPE_META[step.type].icon;
  const [error, setError] = useState('');

  // Локальное состояние формы — своё под каждый тип шага, инициализируется из текущего step
  // и переинициализируется, если сам step обновился извне (после сохранения).
  const [delayValue, setDelayValue] = useState(1);
  const [delayUnit, setDelayUnit] = useState<'hours' | 'days'>('days');
  const [messageText, setMessageText] = useState(step.messageText || '');
  const [buttons, setButtons] = useState<AutomationButton[]>(step.buttons || []);
  const [hasPurchase, setHasPurchase] = useState(step.conditionFilter?.hasPurchase ?? false);

  useEffect(() => {
    const seconds = step.delaySeconds || 0;
    if (seconds % 86400 === 0 && seconds > 0) {
      setDelayUnit('days');
      setDelayValue(seconds / 86400);
    } else {
      setDelayUnit('hours');
      setDelayValue(Math.max(1, Math.round(seconds / 3600)));
    }
    setMessageText(step.messageText || '');
    setButtons(step.buttons || []);
    setHasPurchase(step.conditionFilter?.hasPurchase ?? false);
  }, [step]);

  const save = useMutation({
    mutationFn: () => {
      const payload =
        step.type === 'DELAY'
          ? { delaySeconds: delayValue * (delayUnit === 'days' ? 86400 : 3600) }
          : step.type === 'SEND_PUSH'
            ? { messageText, buttons: buttons.filter((b) => b.text && b.url) }
            : { conditionFilter: { hasPurchase } };
      return api.patch(`/projects/${projectId}/automations/${flowId}/steps/${step.id}`, payload);
    },
    onSuccess: () => {
      onChanged();
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить шаг'),
  });

  const move = useMutation({
    mutationFn: (direction: 'up' | 'down') =>
      api.post(`/projects/${projectId}/automations/${flowId}/steps/${step.id}/move`, { direction }),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}/automations/${flowId}/steps/${step.id}`),
    onSuccess: onChanged,
  });

  const addButton = () => setButtons((b) => [...b, { text: '', url: '' }]);
  const updateButton = (i: number, patch: Partial<AutomationButton>) =>
    setButtons((b) => b.map((btn, idx) => (idx === i ? { ...btn, ...patch } : btn)));
  const removeButton = (i: number) => setButtons((b) => b.filter((_, idx) => idx !== i));

  return (
    <AccordionItem value={step.id}>
      <AccordionTrigger>
        <Icon className="w-4 h-4 shrink-0 text-gray-400" />
        <span className="flex-1 min-w-0 truncate">{stepSummary(step)}</span>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button size="icon" variant="ghost" disabled={isFirst || move.isPending} onClick={() => move.mutate('up')}>
            <ArrowUp className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" disabled={isLast || move.isPending} onClick={() => move.mutate('down')}>
            <ArrowDown className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </AccordionTrigger>
      <AccordionPanel>
        <div className="space-y-4">
          {step.type === 'DELAY' && (
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label>Подождать</Label>
                <Input type="number" min={1} value={delayValue} onChange={(e) => setDelayValue(Number(e.target.value) || 1)} className="w-24" />
              </div>
              <Select value={delayUnit} onValueChange={(v) => v && setDelayUnit(v as typeof delayUnit)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hours">часов</SelectItem>
                  <SelectItem value="days">дней</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {step.type === 'SEND_PUSH' && (
            <>
              <div className="space-y-1.5">
                <Label>Текст сообщения</Label>
                <Textarea rows={4} value={messageText} onChange={(e) => setMessageText(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Кнопки (до 3)</Label>
                {buttons.map((button, i) => (
                  <div key={i} className="flex gap-2">
                    <Input placeholder="Текст кнопки" value={button.text} onChange={(e) => updateButton(i, { text: e.target.value })} />
                    <Input placeholder="https://..." value={button.url} onChange={(e) => updateButton(i, { url: e.target.value })} />
                    <Button size="icon" variant="ghost" onClick={() => removeButton(i)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {buttons.length < 3 && (
                  <Button variant="outline" size="sm" onClick={addButton}>
                    <Plus className="w-4 h-4 mr-1.5" /> Добавить кнопку
                  </Button>
                )}
              </div>
            </>
          )}

          {step.type === 'CONDITION' && (
            <div className="space-y-1.5">
              <Label>Продолжить воронку, если клиент</Label>
              <Select value={hasPurchase ? 'yes' : 'no'} onValueChange={(v) => setHasPurchase(v === 'yes')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Совершил покупку</SelectItem>
                  <SelectItem value="no">Не совершил покупку</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400">Если условие не выполняется — клиент выходит из воронки, следующие шаги не выполняются.</p>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Сохраняем...' : 'Сохранить'}
          </Button>
        </div>
      </AccordionPanel>
    </AccordionItem>
  );
}
