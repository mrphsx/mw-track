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
                <SelectContent>
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
