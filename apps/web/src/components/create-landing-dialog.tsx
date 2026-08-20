'use client';

// Диалог создания лендинга из шаблона — общий для страницы одного проекта
// (projects/[id]/landings) и страницы всех лендингов компании (/landings, запрос пользователя
// 2026-07-21: "сделай возможность создать лэндинга со страницы всех лэндингов напрямую").
// Разница только в projectId: если он передан явно (проектная страница) — поля выбора проекта
// нет; если нет (страница всех лендингов) — внутри диалога появляется обязательный выбор
// проекта, без него "Создать" недоступна.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { api } from '@/lib/api';
import {
  DomainOption,
  NO_DOMAIN,
  SUBSCRIBERS_LABEL_PRESETS,
  SUBSCRIBERS_LABEL_CUSTOM_VALUE as CUSTOM_VALUE,
  attachLandingToDomain,
} from '@/lib/landings';
import { DomainSelect } from '@/components/landing-card';
import { TemplatePicker } from '@/components/template-picker';
import {
  LandingBehaviorFields,
  LandingBehaviorState,
  EMPTY_LANDING_BEHAVIOR,
  behaviorStateToPayload,
} from '@/components/landing-behavior-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ProjectOption {
  id: string;
  name: string;
}

// Единственный шаблон с двумя попапами вместо карточки канала (запрос пользователя
// 2026-08-18) — набор полей формы для него совсем другой (см. AGE_GATE_TEMPLATE_ID ниже).
const AGE_GATE_TEMPLATE_ID = 'age-gate-invite';

interface ProjectChannelInfo {
  channel: { tgChannelTitle: string | null; tgBotFirstName: string | null } | null;
}

export function CreateLandingFromTemplateDialog({
  open,
  onOpenChange,
  projectId: fixedProjectId,
  domains,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Не задан — показываем обязательный выбор проекта внутри диалога (страница всех лендингов).
  projectId?: string;
  domains: DomainOption[] | undefined;
  onCreated?: (landing: { id: string }, projectId: string) => void;
}) {
  const queryClient = useQueryClient();
  const needsProjectPicker = !fixedProjectId;

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const projectId = fixedProjectId || selectedProjectId;

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectOption[]>('/projects')).data,
    enabled: needsProjectPicker && open,
  });

  const [templateId, setTemplateId] = useState('minimal');
  const [templateName, setTemplateName] = useState('');
  const [channelTitleInput, setChannelTitleInput] = useState('');
  const [channelDescriptionInput, setChannelDescriptionInput] = useState('');
  const [buttonText, setButtonText] = useState('Вступить в канал');
  const [subscribersLabel, setSubscribersLabel] = useState('подписчиков');
  const [useCustomLabel, setUseCustomLabel] = useState(false);
  // age-gate-invite — дефолты совпадают с LandingsService.createFromTemplate (показываем
  // пользователю сразу то же, что подставит бэкенд, если оставить поле пустым). Оба попапа на
  // испанском (запрос пользователя 2026-08-18 — "странно что один попап на испанском, другой на
  // русском, пусть всё будет под испанский").
  const [popup1Title, setPopup1Title] = useState('¿Tienes más de 18 años?');
  const [popup1Text, setPopup1Text] = useState('Debes tener 18 años para continuar');
  const [popup1YesText, setPopup1YesText] = useState('Sí');
  const [popup1NoText, setPopup1NoText] = useState('No');
  const [popup2Title, setPopup2Title] = useState('¡Suscríbete a nuestro canal!');
  const [popup2Text, setPopup2Text] = useState('');
  const [popup2ButtonText, setPopup2ButtonText] = useState('Unirse al canal');
  const [templateDomainId, setTemplateDomainId] = useState(NO_DOMAIN);
  const [templateBehavior, setTemplateBehavior] =
    useState<LandingBehaviorState>(EMPTY_LANDING_BEHAVIOR);
  const [error, setError] = useState('');

  // Запрос пользователя 2026-07-27: "название канала будет сразу заполнено текущим названием
  // канала, прикреплённого к проекту" — подтягивается один раз при открытии/выборе проекта, не
  // перезаписывает то, что пользователь уже успел ввести (проверка `!channelTitleInput` ниже).
  const { data: selectedProject } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.get<ProjectChannelInfo>(`/projects/${projectId}`)).data,
    enabled: !!projectId && open,
  });

  useEffect(() => {
    if (channelTitleInput || !selectedProject?.channel) return;
    const title = selectedProject.channel.tgChannelTitle || selectedProject.channel.tgBotFirstName;
    if (title) setChannelTitleInput(title);
  }, [selectedProject, channelTitleInput]);

  const reset = () => {
    onOpenChange(false);
    setSelectedProjectId('');
    setTemplateId('minimal');
    setTemplateName('');
    setChannelTitleInput('');
    setChannelDescriptionInput('');
    setButtonText('Вступить в канал');
    setSubscribersLabel('подписчиков');
    setUseCustomLabel(false);
    setPopup1Title('¿Tienes más de 18 años?');
    setPopup1Text('Debes tener 18 años para continuar');
    setPopup1YesText('Sí');
    setPopup1NoText('No');
    setPopup2Title('¡Suscríbete a nuestro canal!');
    setPopup2Text('');
    setPopup2ButtonText('Unirse al canal');
    setTemplateDomainId(NO_DOMAIN);
    setTemplateBehavior(EMPTY_LANDING_BEHAVIOR);
    setError('');
  };

  const createFromTemplate = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/projects/${projectId}/landings`, {
          name: templateName,
          templateId,
          channelTitle: channelTitleInput || undefined,
          channelDescription: channelDescriptionInput || undefined,
          buttonText,
          subscribersLabel,
          ...(templateId === AGE_GATE_TEMPLATE_ID
            ? {
                popup1Title,
                popup1Text,
                popup1YesText,
                popup1NoText,
                popup2Title,
                popup2Text: popup2Text || undefined,
                popup2ButtonText,
              }
            : {}),
          ...behaviorStateToPayload(templateBehavior),
        })
      ).data as { id: string },
    onSuccess: async (landing) => {
      queryClient.invalidateQueries({ queryKey: ['landings'] });
      if (templateDomainId !== NO_DOMAIN) {
        await attachLandingToDomain(projectId, landing.id, templateDomainId, domains);
        queryClient.invalidateQueries({ queryKey: ['domains'] });
      }
      onCreated?.(landing, projectId);
      reset();
    },
    onError: (err) =>
      setError(
        (isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать лендинг',
      ),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && reset()}>
      <DialogContent className="max-w-4xl lg:max-w-5xl xl:max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новый лендинг из шаблона</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {needsProjectPicker && (
            <div className="space-y-1.5">
              <Label htmlFor="landing-project">Проект</Label>
              <Select
                items={projects?.map((p) => ({ value: p.id, label: p.name })) ?? []}
                value={selectedProjectId || undefined}
                onValueChange={(v) => v && setSelectedProjectId(v)}
              >
                <SelectTrigger id="landing-project">
                  <SelectValue placeholder="Выберите проект" />
                </SelectTrigger>
                <SelectContent className="w-auto min-w-(--anchor-width)">
                  {projects?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="landing-name">Название (внутреннее)</Label>
            <Input
              id="landing-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Шаблон</Label>
            <TemplatePicker value={templateId} onChange={setTemplateId} />
          </div>
          {templateId === AGE_GATE_TEMPLATE_ID ? (
            <div className="space-y-3 border rounded-lg p-3">
              <p className="text-xs text-muted-foreground">
                Попап 1 — вопрос про возраст. Кнопка &quot;Да&quot; всегда открывает попап 2 (никуда не ведёт), кнопка
                &quot;Нет&quot; всегда ведёт на конечный ресурс.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="landing-popup1-title">Попап 1 — заголовок</Label>
                  <Input id="landing-popup1-title" value={popup1Title} onChange={(e) => setPopup1Title(e.target.value)} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="landing-popup1-text">Попап 1 — текст</Label>
                  <Input id="landing-popup1-text" value={popup1Text} onChange={(e) => setPopup1Text(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="landing-popup1-yes">Кнопка &quot;Да&quot; (→ попап 2)</Label>
                  <Input id="landing-popup1-yes" value={popup1YesText} onChange={(e) => setPopup1YesText(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="landing-popup1-no">Кнопка &quot;Нет&quot; (→ конечный ресурс)</Label>
                  <Input id="landing-popup1-no" value={popup1NoText} onChange={(e) => setPopup1NoText(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground pt-2 border-t">
                Попап 2 — приглашение, открывается только по &quot;Да&quot; из попапа 1. Кнопка всегда ведёт на конечный
                ресурс. Если на лендинге включён авторедирект — сработает только здесь, не на попапе 1.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="landing-popup2-title">Попап 2 — заголовок</Label>
                <Input id="landing-popup2-title" value={popup2Title} onChange={(e) => setPopup2Title(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="landing-popup2-text">Попап 2 — текст (необязательно)</Label>
                <Input id="landing-popup2-text" value={popup2Text} onChange={(e) => setPopup2Text(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="landing-popup2-button">Попап 2 — текст кнопки</Label>
                <Input id="landing-popup2-button" value={popup2ButtonText} onChange={(e) => setPopup2ButtonText(e.target.value)} />
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="landing-title">Название канала</Label>
                <Input
                  id="landing-title"
                  value={channelTitleInput}
                  onChange={(e) => setChannelTitleInput(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="landing-description">Описание</Label>
                <Textarea
                  id="landing-description"
                  rows={3}
                  value={channelDescriptionInput}
                  onChange={(e) => setChannelDescriptionInput(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="landing-button">Текст кнопки</Label>
                <Input
                  id="landing-button"
                  value={buttonText}
                  onChange={(e) => setButtonText(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="landing-subscribers-label">
                  Слово &quot;подписчиков&quot; на лендинге
                </Label>
                <Select
                  value={useCustomLabel ? CUSTOM_VALUE : subscribersLabel}
                  onValueChange={(v) => {
                    if (!v) return;
                    if (v === CUSTOM_VALUE) {
                      setUseCustomLabel(true);
                    } else {
                      setUseCustomLabel(false);
                      setSubscribersLabel(v);
                    }
                  }}
                >
                  <SelectTrigger id="landing-subscribers-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="w-auto min-w-(--anchor-width)">
                    {SUBSCRIBERS_LABEL_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_VALUE}>Свой вариант</SelectItem>
                  </SelectContent>
                </Select>
                {useCustomLabel && (
                  <Input
                    value={subscribersLabel}
                    onChange={(e) => setSubscribersLabel(e.target.value)}
                    placeholder="Своё слово"
                    className="max-w-60"
                  />
                )}
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="landing-domain">Домен (необязательно)</Label>
            <DomainSelect
              id="landing-domain"
              value={templateDomainId}
              onChange={setTemplateDomainId}
              domains={domains}
            />
          </div>

          <div className="pt-1 border-t">
            <LandingBehaviorFields
              idPrefix="new-template"
              state={templateBehavior}
              onChange={(patch) => setTemplateBehavior((s) => ({ ...s, ...patch }))}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button
            onClick={() => createFromTemplate.mutate()}
            disabled={!templateName || !projectId || createFromTemplate.isPending}
          >
            {createFromTemplate.isPending ? 'Создаём...' : 'Создать'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
