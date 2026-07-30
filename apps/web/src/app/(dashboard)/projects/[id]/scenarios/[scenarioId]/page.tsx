'use client';

// Редактор сценария — редизайн 2026-07-25 (запрос пользователя). Отличия от прежней версии:
// 1) Элемент = один тип контента (текст/фото/видео/альбом/кружок/голосовое) + опциональная
//    кнопка — не свободная форма "текст+медиа+кнопки сразу". Если нужно и текст, и медиа —
//    это два отдельных элемента подряд, а не одно составное сообщение.
// 2) Условие и отдельный блок "Задержка" убраны из добавляемых элементов (пока) — задержка
//    теперь поле внутри самого элемента (см. ElementAccordionItem).
// 3) У каждого элемента явная подпись типа (см. lib/scenarios.ts elementLabel).
// 4) Превью не развёрнуто по умолчанию — отдельная кнопка (ElementPreviewDialog).
// На бэкенде элемент — по-прежнему 1-2 реальных BotScenarioStep (SEND_MESSAGE + опциональный
// DELAY перед ним), полностью скрыто в BotScenariosService — фронтенд работает только с
// плоским списком элементов из GET .../scenarios/:id.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosResponse, isAxiosError } from 'axios';
import { ArrowDown, ArrowLeft, ArrowUp, BarChart3, FlaskConical, History, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import {
  AbTestStats,
  BotScenarioDetail,
  CONTENT_TYPE_META,
  CONTENT_TYPES,
  ElementContentType,
  ScenarioButton,
  ScenarioElement,
  ScenarioMediaItem,
  TRIGGER_TYPE_ICON,
  TRIGGER_TYPE_LABEL,
  deriveContentType,
  elementLabel,
  scenarioTitle,
} from '@/lib/scenarios';
import { ElementMediaEditor } from '@/components/scenarios/element-media-editor';
import { ElementPreviewDialog } from '@/components/scenarios/element-preview-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MessagePlaceholdersHint } from '@/components/message-placeholders-hint';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from '@/components/ui/accordion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type DelayUnit = 'minutes' | 'hours' | 'days';
const DELAY_UNIT_SECONDS: Record<DelayUnit, number> = { minutes: 60, hours: 3600, days: 86400 };

function secondsToDelayInput(seconds: number): { value: number; unit: DelayUnit } {
  if (seconds > 0 && seconds % 86400 === 0) return { value: seconds / 86400, unit: 'days' };
  if (seconds > 0 && seconds % 3600 === 0) return { value: seconds / 3600, unit: 'hours' };
  if (seconds > 0 && seconds % 60 === 0) return { value: seconds / 60, unit: 'minutes' };
  return { value: 1, unit: 'hours' };
}

function delayBadge(seconds: number): string | null {
  if (!seconds) return null;
  const { value, unit } = secondsToDelayInput(seconds);
  const unitLabel = unit === 'days' ? (value === 1 ? 'день' : 'дн.') : unit === 'hours' ? 'ч' : 'мин';
  return `через ${value} ${unitLabel}`;
}

interface ProjectChannel {
  channel: { id: string } | null;
}

export default function ScenarioEditorPage() {
  const { id: projectId, scenarioId } = useParams<{ id: string; scenarioId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.get<ProjectChannel>(`/projects/${projectId}`)).data,
  });
  const channelId = project?.channel?.id;

  const { data: scenario } = useQuery({
    queryKey: ['channel', channelId, 'scenarios', scenarioId],
    queryFn: async () => (await api.get<BotScenarioDetail>(`/channels/${channelId}/scenarios/${scenarioId}`)).data,
    enabled: !!channelId,
  });

  const invalidateScenario = () => queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'scenarios', scenarioId] });
  const invalidateList = () => queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'scenarios'] });

  const toggleActive = useMutation({
    mutationFn: (isActive: boolean) => api.patch(`/channels/${channelId}/scenarios/${scenarioId}`, { isActive }),
    onSuccess: () => {
      invalidateScenario();
      invalidateList();
    },
  });

  const removeScenario = useMutation({
    mutationFn: () => api.delete(`/channels/${channelId}/scenarios/${scenarioId}`),
    onSuccess: () => router.push(`/projects/${projectId}/scenarios`),
  });

  // Новый элемент создаётся сразу пустым под выбранный тип (тот же порядок, что был у "добавить
  // шаг" раньше) — сервер не хранит явный "тип контента" (выводится из messageMedia), поэтому
  // храним, какой тип выбрали для только что созданного пустого элемента, локально, пока в нём
  // нет реальных данных — иначе он временно выглядел бы как "Текст" до первой загрузки файла.
  const [justCreated, setJustCreated] = useState<{ elementId: string; type: ElementContentType } | null>(null);

  const addElement = useMutation<AxiosResponse<ScenarioElement>, unknown, ElementContentType>({
    mutationFn: () =>
      api.post<ScenarioElement>(`/channels/${channelId}/scenarios/${scenarioId}/elements`, {
        messageText: '',
        messageMedia: [],
        buttons: [],
      }),
    onSuccess: (res, type) => {
      invalidateScenario();
      invalidateList();
      setJustCreated({ elementId: res.data.id, type });
    },
  });

  if (!scenario) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  const TriggerIcon = TRIGGER_TYPE_ICON[scenario.triggerType];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/scenarios`}
          className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Все сценарии
        </Link>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-semibold truncate flex items-center gap-2">
            <TriggerIcon className="w-5 h-5 shrink-0 text-muted-foreground" />
            {/* Синтетический command варианта A/B-теста (см. dto/scenario-ab-test.dto.ts) не
                показываем — scenarioTitle для COMMAND-триггера отдал бы "__ab_xxxxx", реальное
                имя команды хранится только у основного сценария группы. */}
            {scenario.isAbTestVariant ? 'Вариант A/B-теста' : scenarioTitle(scenario)}
          </h1>
          <div className="flex items-center gap-3">
            <Badge variant="outline">{TRIGGER_TYPE_LABEL[scenario.triggerType]}</Badge>
            <div className="flex items-center gap-1.5">
              <Label className="text-sm">Активен</Label>
              <Switch checked={scenario.isActive} onCheckedChange={(checked) => toggleActive.mutate(checked)} />
            </div>
            <Button size="sm" variant="outline" onClick={() => router.push(`/projects/${projectId}/scenarios/${scenarioId}/stats`)}>
              <BarChart3 className="w-3.5 h-3.5 mr-1.5" /> Статистика
            </Button>
            <Button size="sm" variant="ghost" onClick={() => confirm('Удалить сценарий?') && removeScenario.mutate()}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <AbTestSection channelId={channelId!} projectId={projectId} scenarioId={scenarioId} scenario={scenario} onChanged={invalidateList} />

      <div className="space-y-3">
        {scenario.elements.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">Элементов пока нет — добавьте первый ниже.</CardContent>
          </Card>
        ) : (
          <Accordion keepMounted>
            {scenario.elements.map((element, i) => (
              <ElementAccordionItem
                key={element.id}
                channelId={channelId!}
                scenarioId={scenarioId}
                element={element}
                isFirst={i === 0}
                isLast={i === scenario.elements.length - 1}
                onChanged={() => {
                  invalidateScenario();
                  invalidateList();
                }}
                initialType={justCreated?.elementId === element.id ? justCreated.type : undefined}
                onOpenedInitialType={() => setJustCreated(null)}
              />
            ))}
          </Accordion>
        )}

        <div className="space-y-1.5">
          <span className="text-sm text-muted-foreground">Добавить элемент:</span>
          <div className="flex items-center gap-2 flex-wrap">
            {CONTENT_TYPES.map((type) => {
              const Icon = CONTENT_TYPE_META[type].icon;
              return (
                <Button key={type} size="sm" variant="outline" onClick={() => addElement.mutate(type)} disabled={addElement.isPending}>
                  <Icon className="w-4 h-4 mr-1.5" /> {CONTENT_TYPE_META[type].label}
                </Button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ElementAccordionItem({
  channelId,
  scenarioId,
  element,
  isFirst,
  isLast,
  onChanged,
  initialType,
  onOpenedInitialType,
}: {
  channelId: string;
  scenarioId: string;
  element: ScenarioElement;
  isFirst: boolean;
  isLast: boolean;
  onChanged: () => void;
  initialType?: ElementContentType;
  onOpenedInitialType: () => void;
}) {
  const [contentType, setContentType] = useState<ElementContentType>(initialType ?? deriveContentType(element));
  const [messageText, setMessageText] = useState(element.messageText || '');
  const [media, setMedia] = useState<ScenarioMediaItem[]>(element.messageMedia || []);
  const [buttons, setButtons] = useState<ScenarioButton[]>(element.buttons || []);
  const initialDelay = secondsToDelayInput(element.delaySeconds);
  const [delayEnabled, setDelayEnabled] = useState(element.delaySeconds > 0);
  const [delayValue, setDelayValue] = useState(initialDelay.value);
  const [delayUnit, setDelayUnit] = useState<DelayUnit>(initialDelay.unit);
  const [error, setError] = useState('');

  useEffect(() => {
    // Внешнее изменение (например, после сохранения) — синхронизируем локальное состояние,
    // но НЕ трогаем uже открытый выбор типа контента пользователем в этой сессии редактирования.
    setMessageText(element.messageText || '');
    setMedia(element.messageMedia || []);
    setButtons(element.buttons || []);
    const d = secondsToDelayInput(element.delaySeconds);
    setDelayEnabled(element.delaySeconds > 0);
    setDelayValue(d.value);
    setDelayUnit(d.unit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element.id, element.delaySeconds, element.messageText, element.messageMedia, element.buttons]);

  useEffect(() => {
    if (initialType) onOpenedInitialType();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Смена типа контента сбрасывает медиа — тот же баг-класс, что уже ловили в приветственном
  // сообщении (2026-07-24): нельзя оставлять файл, выбранный/загруженный под ДРУГИМ типом,
  // "как есть" при переключении типа, иначе он молча уйдёт под новым лейблом.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setMedia([]);
  }, [contentType]);

  const save = useMutation({
    mutationFn: () => {
      const delaySeconds = delayEnabled ? delayValue * DELAY_UNIT_SECONDS[delayUnit] : 0;
      return api.patch(`/channels/${channelId}/scenarios/${scenarioId}/elements/${element.id}`, {
        delaySeconds,
        messageText: contentType === 'VIDEO_NOTE' ? '' : messageText,
        messageMedia: contentType === 'TEXT' ? [] : media,
        buttons: buttons.filter((b) => b.text && b.url),
      });
    },
    onSuccess: () => {
      onChanged();
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить элемент'),
  });

  const move = useMutation({
    mutationFn: (direction: 'up' | 'down') => api.post(`/channels/${channelId}/scenarios/${scenarioId}/elements/${element.id}/move`, { direction }),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/channels/${channelId}/scenarios/${scenarioId}/elements/${element.id}`),
    onSuccess: onChanged,
  });

  const addButton = () => setButtons((b) => [...b, { text: '', url: '' }]);
  const updateButton = (i: number, patch: Partial<ScenarioButton>) => setButtons((b) => b.map((btn, idx) => (idx === i ? { ...btn, ...patch } : btn)));
  const removeButton = (i: number) => setButtons((b) => b.filter((_, idx) => idx !== i));

  const Icon = CONTENT_TYPE_META[contentType].icon;
  const badge = delayBadge(delayEnabled ? delayValue * DELAY_UNIT_SECONDS[delayUnit] : 0);

  return (
    <AccordionItem value={element.id}>
      <AccordionTrigger>
        <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 min-w-0 truncate">{elementLabel(element, contentType)}</span>
        {badge && (
          <span className="text-xs text-muted-foreground shrink-0" onClick={(e) => e.stopPropagation()}>
            {badge}
          </span>
        )}
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
          <div className="space-y-1.5">
            <Label>Тип содержимого</Label>
            <Select value={contentType} onValueChange={(v) => v && setContentType(v as ElementContentType)}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {CONTENT_TYPE_META[type].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Switch checked={delayEnabled} onCheckedChange={setDelayEnabled} />
              <Label>Отправить с задержкой</Label>
            </div>
            {delayEnabled && (
              <div className="flex items-end gap-2">
                <Input type="number" min={1} value={delayValue} onChange={(e) => setDelayValue(Number(e.target.value) || 1)} className="w-24" />
                <Select value={delayUnit} onValueChange={(v) => v && setDelayUnit(v as DelayUnit)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">минут</SelectItem>
                    <SelectItem value="hours">часов</SelectItem>
                    <SelectItem value="days">дней</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {contentType !== 'TEXT' && <ElementMediaEditor channelId={channelId} contentType={contentType} value={media} onChange={setMedia} />}

          {contentType !== 'VIDEO_NOTE' && (
            <div className="space-y-1.5">
              <Label>{contentType === 'TEXT' ? 'Текст сообщения' : 'Подпись (необязательно)'}</Label>
              <Textarea
                rows={contentType === 'TEXT' ? 4 : 2}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Поддерживаются HTML-теги Telegram: <b>, <i>, <u>, <code>"
              />
              <MessagePlaceholdersHint onInsert={(token) => setMessageText((t) => t + token)} />
              <div className="text-xs text-muted-foreground text-right">{messageText.length} / 4096</div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Кнопка (до 3)</Label>
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
                Добавить кнопку
              </Button>
            )}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Сохраняем...' : 'Сохранить'}
            </Button>
            <ElementPreviewDialog
              text={contentType === 'VIDEO_NOTE' ? '' : messageText}
              media={contentType === 'TEXT' ? [] : media}
              buttons={buttons}
            />
          </div>
        </div>
      </AccordionPanel>
    </AccordionItem>
  );
}

// A/B-тест сценариев (запрос пользователя 2026-07-25: "как мы сделали для груп лэндингов...
// нужно для сценариев сделать примерно так же") — до старта теста просто CTA "Добавить вариант",
// после — управление весами + ссылки на настройку каждого варианта (полноценные отдельные
// сценарии, каждый со своей страницей редактора) + переход на подробную статистику. Работает
// одинаково независимо от того, основной ли сценарий сейчас открыт или один из вариантов —
// GET .../ab-test/stats резолвит всю группу от любого её члена.
function AbTestSection({
  channelId,
  projectId,
  scenarioId,
  scenario,
  onChanged,
}: {
  channelId: string;
  projectId: string;
  scenarioId: string;
  scenario: BotScenarioDetail;
  onChanged: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const abTestQueryKey = ['channel', channelId, 'scenarios', scenarioId, 'ab-test'];

  const { data: abStats } = useQuery({
    queryKey: abTestQueryKey,
    queryFn: async () => (await api.get<AbTestStats>(`/channels/${channelId}/scenarios/${scenarioId}/ab-test/stats`)).data,
    enabled: !!scenario.abTestGroupId,
  });

  const [weights, setWeights] = useState<Record<string, number>>({});
  useEffect(() => {
    if (abStats) setWeights(Object.fromEntries(abStats.variants.map((v) => [v.scenarioId, v.weight])));
  }, [abStats]);

  const addVariant = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/channels/${channelId}/scenarios/${scenarioId}/ab-test/variant`),
    onSuccess: (res) => {
      onChanged();
      router.push(`/projects/${projectId}/scenarios/${res.data.id}`);
    },
  });

  const saveWeights = useMutation({
    mutationFn: () =>
      api.patch(`/channels/${channelId}/scenarios/${scenarioId}/ab-test/weights`, {
        weights: Object.entries(weights).map(([id, weight]) => ({ scenarioId: id, weight })),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: abTestQueryKey }),
  });

  const endTest = useMutation({
    mutationFn: () => api.post(`/channels/${channelId}/scenarios/${scenarioId}/ab-test/end`),
    // Баг-репорт пользователя 2026-07-25: "после завершения... в карточке всё ещё пишет A/B, а
    // я не могу сделать ещё A/B тест" — endAbTest теперь очищает abTestGroupId у сценария
    // (см. комментарий в BotScenariosService.endAbTest), но само это изменение нужно
    // перезапросить: и карточку в списке (onChanged → invalidateList), и сам сценарий этой
    // страницы (иначе scenario.abTestGroupId в памяти останется старым, AbTestSection не
    // переключится обратно на CTA "Добавить вариант").
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: abTestQueryKey });
      queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'scenarios', scenarioId] });
      onChanged();
    },
  });

  // Сценарий-вариант не предлагает создать вложенный под-вариант (бэкенд это и так отклонит,
  // но не показываем саму возможность — см. BotScenariosService.addAbTestVariant).
  if (!scenario.abTestGroupId) {
    if (scenario.isAbTestVariant) return null;
    return (
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-medium text-sm flex items-center gap-1.5">
              <FlaskConical className="w-4 h-4" /> A/B-тест
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Добавьте альтернативную версию сценария и сравните, какая лучше конвертирует.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => addVariant.mutate()} disabled={addVariant.isPending}>
            <FlaskConical className="w-3.5 h-3.5 mr-1.5" /> {addVariant.isPending ? 'Создаём...' : 'Добавить вариант'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!abStats) return null;

  // Завершённый тест здесь не разворачиваем (запрос пользователя 2026-07-25: "не показывай так,
  // на отдельной странице лучше") — только компактная заметка + ссылка в историю, полная
  // таблица по вариантам живёт на /scenarios/history.
  if (abStats.endedAt) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm flex items-center gap-1.5">
            <FlaskConical className="w-4 h-4 text-muted-foreground" /> A/B-тест завершён
            <Badge variant="outline" className="ml-1">
              {abStats.variants.length} {abStats.variants.length === 1 ? 'вариант' : 'варианта'}
            </Badge>
          </p>
          <Link href={`/projects/${projectId}/scenarios/history`} className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
            <History className="w-3.5 h-3.5" /> Смотреть в истории
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="font-medium text-sm flex items-center gap-1.5">
            <FlaskConical className="w-4 h-4" /> A/B-тест
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => addVariant.mutate()} disabled={addVariant.isPending}>
              <FlaskConical className="w-3.5 h-3.5 mr-1.5" /> Ещё вариант
            </Button>
            <Button size="sm" variant="outline" onClick={() => router.push(`/projects/${projectId}/scenarios/${scenarioId}/ab-test`)}>
              <BarChart3 className="w-3.5 h-3.5 mr-1.5" /> Подробная статистика
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => confirm('Завершить A/B-тест? Текущая статистика зафиксируется, дальше веса менять будет нельзя.') && endTest.mutate()}
              disabled={endTest.isPending}
            >
              Завершить тест
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {abStats.variants.map((v, i) => (
            <div key={v.scenarioId} className="flex items-center gap-3 text-sm flex-wrap">
              <span className="font-medium w-24 shrink-0">Вариант {String.fromCharCode(65 + i)}</span>
              <div className="flex items-center gap-1 shrink-0">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="w-16"
                  value={weights[v.scenarioId] ?? v.weight}
                  onChange={(e) => setWeights((w) => ({ ...w, [v.scenarioId]: Number(e.target.value) || 0 }))}
                />
                <span className="text-muted-foreground">%</span>
              </div>
              <span className="text-muted-foreground shrink-0">{v.received} получили</span>
              {!v.isActive && (
                <Badge variant="outline" className="shrink-0">
                  Выключен
                </Badge>
              )}
              <div className="flex-1" />
              {v.scenarioId === scenarioId ? (
                <Badge variant="outline" className="shrink-0">
                  Открыт сейчас
                </Badge>
              ) : (
                <Button size="sm" variant="link" className="shrink-0" onClick={() => router.push(`/projects/${projectId}/scenarios/${v.scenarioId}`)}>
                  Настроить →
                </Button>
              )}
            </div>
          ))}
        </div>

        <Button size="sm" variant="outline" onClick={() => saveWeights.mutate()} disabled={saveWeights.isPending}>
          {saveWeights.isPending ? 'Сохраняем...' : 'Сохранить веса'}
        </Button>
      </CardContent>
    </Card>
  );
}
