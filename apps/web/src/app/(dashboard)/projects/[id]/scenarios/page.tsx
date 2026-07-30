'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import Link from 'next/link';
import { ArrowRight, BarChart3, CheckCircle2, Clock, FlaskConical, History, Plus, Settings, TriangleAlert, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import {
  BotScenarioListItem,
  CONTENT_TYPE_META,
  RUN_STATUS_LABEL,
  ScenarioAbTestGroupListItem,
  SINGLETON_TRIGGERS,
  TRIGGER_TYPE_ICON,
  scenarioTitle,
} from '@/lib/scenarios';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ProjectChannel {
  channel: { id: string } | null;
}

const CommandIcon = TRIGGER_TYPE_ICON.COMMAND;

// Иконки вместо текстовых подписей для статусов ранов на карточке (запрос пользователя
// 2026-07-25: "вместо текста, можешь просто иконки подобрать") — та же палитра/значения, что
// на странице статистики (StatusIcon + title-тултип с русской подписью для доступности).
const RUN_STATUS_ICON: Record<keyof BotScenarioListItem['runCounts'], typeof CheckCircle2> = {
  completed: CheckCircle2,
  active: Clock,
  failed: XCircle,
  exited: TriangleAlert,
};

const RUN_COUNT_COLOR: Record<keyof BotScenarioListItem['runCounts'], string> = {
  completed: 'text-green-600 dark:text-green-400',
  active: 'text-muted-foreground',
  failed: 'text-red-600 dark:text-red-400',
  exited: 'text-amber-600 dark:text-amber-400',
};

// Список сценариев бота (запрос пользователя 2026-07-22: объединение с автоворонками —
// сценарии теперь тоже поддерживают цепочку шагов, редактируются на отдельной странице
// /scenarios/[id]). Редизайн 2026-07-25 (запрос пользователя): карточки во всю ширину,
// статистика по ранам (успешно/в ожидании/ошибка/прервано отдельно) и последовательность типов
// элементов прямо на карточке; клик по всей карточке убран — явные кнопки "Настроить"/
// "Статистика" вместо него.
export default function ScenariosPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.get<ProjectChannel>(`/projects/${projectId}`)).data,
  });
  const channelId = project?.channel?.id;

  const { data: scenarios, isLoading } = useQuery({
    queryKey: ['channel', channelId, 'scenarios'],
    queryFn: async () => (await api.get<BotScenarioListItem[]>(`/channels/${channelId}/scenarios`)).data,
    enabled: !!channelId,
  });

  // Только чтобы решить, показывать ли ссылку "История A/B-тестов" (запрос пользователя
  // 2026-07-25) — сам список завершённых тестов живёт на отдельной странице.
  const { data: abTestGroups } = useQuery({
    queryKey: ['channel', channelId, 'scenario-ab-test-groups'],
    queryFn: async () => (await api.get<ScenarioAbTestGroupListItem[]>(`/channels/${channelId}/scenarios/ab-test-groups`)).data,
    enabled: !!channelId,
  });
  const hasEndedAbTestGroups = (abTestGroups ?? []).some((g) => g.endedAt);

  const [showCreateCommand, setShowCreateCommand] = useState(false);
  const [command, setCommand] = useState('');
  const [error, setError] = useState('');

  const createScenario = useMutation({
    mutationFn: async (dto: { triggerType: string; command?: string }) =>
      (await api.post(`/channels/${channelId}/scenarios`, dto)).data as { id: string },
    onSuccess: (scenario) => {
      queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'scenarios'] });
      router.push(`/projects/${projectId}/scenarios/${scenario.id}`);
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать сценарий'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ scenarioId, isActive }: { scenarioId: string; isActive: boolean }) =>
      api.patch(`/channels/${channelId}/scenarios/${scenarioId}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'scenarios'] }),
  });

  const openSingleton = (triggerType: string) => createScenario.mutate({ triggerType });

  const commandScenarios = scenarios?.filter((s) => s.triggerType === 'COMMAND') || [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Сценарии</h1>
          <p className="text-sm text-muted-foreground">Цепочки сообщений бота: элемент → элемент → элемент...</p>
        </div>
        {hasEndedAbTestGroups && (
          <Link
            href={`/projects/${projectId}/scenarios/history`}
            className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
          >
            <History className="w-3.5 h-3.5" /> История A/B-тестов
          </Link>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}

      {!isLoading && (
        <div className="space-y-3">
          {SINGLETON_TRIGGERS.map((trigger) => {
            const scenario = scenarios?.find((s) => s.triggerType === trigger.value);
            return (
              <ScenarioCard
                key={trigger.value}
                projectId={projectId}
                title={trigger.title}
                description={trigger.description}
                icon={TRIGGER_TYPE_ICON[trigger.value]}
                scenario={scenario}
                onToggle={(isActive) => scenario && toggleActive.mutate({ scenarioId: scenario.id, isActive })}
                onCreate={() => openSingleton(trigger.value)}
                creating={createScenario.isPending}
              />
            );
          })}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Команды</h2>
          <Button size="sm" variant="outline" onClick={() => setShowCreateCommand(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Добавить команду
          </Button>
        </div>

        {!isLoading && commandScenarios.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">Команд пока нет.</CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {commandScenarios.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              projectId={projectId}
              title={scenarioTitle(scenario)}
              icon={CommandIcon}
              scenario={scenario}
              onToggle={(isActive) => toggleActive.mutate({ scenarioId: scenario.id, isActive })}
            />
          ))}
        </div>
      </div>

      <Dialog open={showCreateCommand} onOpenChange={(open) => !open && setShowCreateCommand(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Новая команда</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="command-name">Команда (без /)</Label>
              <Input id="command-name" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="promo" />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button
              onClick={() => createScenario.mutate({ triggerType: 'COMMAND', command })}
              disabled={!command || createScenario.isPending}
            >
              {createScenario.isPending ? 'Создаём...' : 'Создать и настроить шаги'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScenarioCard({
  projectId,
  title,
  description,
  icon: Icon,
  scenario,
  onToggle,
  onCreate,
  creating,
}: {
  projectId: string;
  title: string;
  description?: string;
  icon: typeof Settings;
  scenario?: BotScenarioListItem;
  onToggle: (isActive: boolean) => void;
  onCreate?: () => void;
  creating?: boolean;
}) {
  const router = useRouter();

  return (
    <Card>
      <CardContent className="p-3.5 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
          <p className="font-medium truncate" title={description}>
            {title}
          </p>
          {/* Завершённый тест здесь не показываем вообще (запрос пользователя 2026-07-25: "не
              показывай так, на отдельной странице лучше") — только пока тест активен. */}
          {scenario?.abTestGroupId && !scenario.abTestEndedAt && (
            <Badge variant="outline" className="shrink-0 inline-flex items-center gap-1">
              <FlaskConical className="w-3 h-3" /> A/B
            </Badge>
          )}
        </div>

        {!scenario ? (
          <>
            <Badge variant="outline" className="shrink-0">
              Не настроено
            </Badge>
            <div className="flex-1" />
            {onCreate && (
              <Button size="sm" variant="outline" onClick={onCreate} disabled={creating}>
                <Settings className="w-3.5 h-3.5 mr-1.5" /> {creating ? 'Создаём...' : 'Настроить'}
              </Button>
            )}
          </>
        ) : (
          <>
            {scenario.elementTypes.length > 0 && (
              <div className="flex items-center gap-1 shrink-0 text-muted-foreground" title={scenario.elementTypes.map((t) => CONTENT_TYPE_META[t].label).join(' → ')}>
                {scenario.elementTypes.map((type, i) => {
                  const ElIcon = CONTENT_TYPE_META[type].icon;
                  return (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <ArrowRight className="w-3 h-3 shrink-0 opacity-50" />}
                      <ElIcon className="w-3.5 h-3.5" />
                    </span>
                  );
                })}
              </div>
            )}

            <div className="flex-1" />

            <div className="flex items-center gap-3 shrink-0 mr-4">
              {(Object.keys(scenario.runCounts) as (keyof BotScenarioListItem['runCounts'])[]).map((key) => {
                const StatusIcon = RUN_STATUS_ICON[key];
                return (
                  <span key={key} className={`inline-flex items-center gap-1 text-sm ${RUN_COUNT_COLOR[key]}`} title={RUN_STATUS_LABEL[key]}>
                    <StatusIcon className="w-3.5 h-3.5" /> {scenario.runCounts[key]}
                  </span>
                );
              })}
            </div>

            <Switch checked={scenario.isActive} onCheckedChange={onToggle} className="shrink-0" />
            <Button size="sm" variant="outline" onClick={() => router.push(`/projects/${projectId}/scenarios/${scenario.id}`)}>
              <Settings className="w-3.5 h-3.5 mr-1.5" /> Настроить
            </Button>
            <Button size="sm" variant="outline" onClick={() => router.push(`/projects/${projectId}/scenarios/${scenario.id}/stats`)}>
              <BarChart3 className="w-3.5 h-3.5 mr-1.5" /> Статистика
            </Button>
            {scenario.abTestGroupId && !scenario.abTestEndedAt && (
              <Button size="sm" variant="outline" onClick={() => router.push(`/projects/${projectId}/scenarios/${scenario.id}/ab-test`)}>
                <FlaskConical className="w-3.5 h-3.5 mr-1.5" /> A/B
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
