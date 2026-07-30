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
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../../../ui';

interface ProjectChannel {
  channel: { id: string } | null;
}

const CommandIcon = TRIGGER_TYPE_ICON.COMMAND;

// Иконки статуса ранов — те же лайблы/значения, что у классической страницы, только цвета
// переведены на палитру Studio (sage=успех, slate=в ожидании, red=ошибка (вне 5-оттеночной
// палитры — семантика "опасности" уже так закреплена в этом дизайне, см. StatusPill danger
// на projects/[id]/page.tsx), amber=прервано).
const RUN_STATUS_ICON: Record<keyof BotScenarioListItem['runCounts'], typeof CheckCircle2> = {
  completed: CheckCircle2,
  active: Clock,
  failed: XCircle,
  exited: TriangleAlert,
};

const RUN_COUNT_CLASS: Record<keyof BotScenarioListItem['runCounts'], string> = {
  completed: 'text-[#1F7A6C] dark:text-[#6FCBBA]',
  active: 'text-[#5F6B7A] dark:text-[#92A0AF]',
  failed: 'text-red-600 dark:text-red-400',
  exited: 'text-[#1F4E9C] dark:text-[#7BA9EE]',
};

// Studio-версия страницы сценариев (запрос пользователя 2026-07-30: "сделай страницу Сценарии...
// учти всё что мы правили для дизайна studio") — beta, доступна пока только через переход с
// Studio-страницы проекта (кнопка "Сценарии" там ведёт сюда, не на классический /scenarios).
// Логика 1:1 с классической страницей (apps/web/.../(dashboard)/projects/[id]/scenarios/page.tsx)
// — те же запросы/мутации/диалоги, отличается только визуальное оформление (Studio-палитра,
// радиус rounded-lg/xl, общие StudioPill/StudioLinkButton из ../../../ui.tsx).
export default function StudioScenariosPage() {
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
      router.push(`/dashboard/studio/projects/${projectId}/scenarios/${scenario.id}`);
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
          <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Сценарии</h1>
          <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1">Цепочки сообщений бота: элемент → элемент → элемент...</p>
        </div>
        {hasEndedAbTestGroups && (
          <Link
            href={`/dashboard/studio/projects/${projectId}/scenarios/history`}
            className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors inline-flex items-center gap-1.5"
          >
            <History className="w-3.5 h-3.5" /> История A/B-тестов
          </Link>
        )}
      </div>

      {isLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {!isLoading && (
        <div className="space-y-3">
          {SINGLETON_TRIGGERS.map((trigger) => {
            const scenario = scenarios?.find((s) => s.triggerType === trigger.value);
            return (
              <StudioScenarioCard
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
          <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3]">Команды</h2>
          <StudioLinkButton size="sm" icon={Plus} onClick={() => setShowCreateCommand(true)}>
            Добавить команду
          </StudioLinkButton>
        </div>

        {!isLoading && commandScenarios.length === 0 && (
          <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>Команд пока нет.</div>
        )}

        <div className="space-y-3">
          {commandScenarios.map((scenario) => (
            <StudioScenarioCard
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
            <button
              type="button"
              onClick={() => createScenario.mutate({ triggerType: 'COMMAND', command })}
              disabled={!command || createScenario.isPending}
              className="w-full text-sm px-4 py-2 rounded-lg bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {createScenario.isPending ? 'Создаём...' : 'Создать и настроить шаги'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StudioScenarioCard({
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
    <div className={`${STUDIO_CARD} p-3.5 flex items-center gap-4 flex-wrap`}>
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        <Icon className="w-4 h-4 shrink-0 text-[#5F6B7A] dark:text-[#92A0AF]" />
        <p className="font-medium truncate text-[#131A24] dark:text-[#E9EDF3]" title={description}>
          {title}
        </p>
        {scenario?.abTestGroupId && !scenario.abTestEndedAt && (
          <StudioPill hue="plum">
            <span className="inline-flex items-center gap-1">
              <FlaskConical className="w-3 h-3" /> A/B
            </span>
          </StudioPill>
        )}
      </div>

      {!scenario ? (
        <>
          <StudioPill hue="slate">Не настроено</StudioPill>
          <div className="flex-1" />
          {onCreate && (
            <StudioLinkButton size="sm" icon={Settings} onClick={onCreate} disabled={creating}>
              {creating ? 'Создаём...' : 'Настроить'}
            </StudioLinkButton>
          )}
        </>
      ) : (
        <>
          {scenario.elementTypes.length > 0 && (
            <div
              className="flex items-center gap-1 shrink-0 text-[#5F6B7A] dark:text-[#92A0AF]"
              title={scenario.elementTypes.map((t) => CONTENT_TYPE_META[t].label).join(' → ')}
            >
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
                <span key={key} className={`inline-flex items-center gap-1 text-sm ${RUN_COUNT_CLASS[key]}`} title={RUN_STATUS_LABEL[key]}>
                  <StatusIcon className="w-3.5 h-3.5" /> {scenario.runCounts[key]}
                </span>
              );
            })}
          </div>

          <Switch checked={scenario.isActive} onCheckedChange={onToggle} className="shrink-0" />
          <StudioLinkButton size="sm" icon={Settings} onClick={() => router.push(`/dashboard/studio/projects/${projectId}/scenarios/${scenario.id}`)}>
            Настроить
          </StudioLinkButton>
          <StudioLinkButton size="sm" icon={BarChart3} onClick={() => router.push(`/dashboard/studio/projects/${projectId}/scenarios/${scenario.id}/stats`)}>
            Статистика
          </StudioLinkButton>
          {scenario.abTestGroupId && !scenario.abTestEndedAt && (
            <StudioLinkButton size="sm" icon={FlaskConical} onClick={() => router.push(`/dashboard/studio/projects/${projectId}/scenarios/${scenario.id}/ab-test`)}>
              A/B
            </StudioLinkButton>
          )}
        </>
      )}
    </div>
  );
}
