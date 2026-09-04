'use client';

// Экспортируемые компоненты вкладок настроек проекта — вынесены из page.tsx (запрос
// пользователя 2026-07-30: Studio-версия страницы настроек должна переиспользовать их как есть,
// но Next.js App Router запрещает произвольные именованные export из файла page.tsx ("is not a
// valid Page export field") — единственный способ шарить их между классической и Studio-
// страницей был вынести в обычный, не-page модуль. Ничего в самих компонентах не изменилось,
// это чисто механический перенос.
import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Check, Copy, Eye, EyeOff, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { ChannelAvatar } from '@/components/channel-avatar';
import { hasChannelAvatar } from '@/lib/landings';
import { TimezoneInput } from '@/components/timezone-input';
import { LINK_PARAM_FIELDS, LINK_PARAM_NAME_REGEX, resolveParamMap } from '@/lib/link-params';
import { TRACKING_EVENT_TYPES } from '@/lib/tracking-events';
import { Switch } from '@/components/ui/switch';
import {
  CHANNEL_TYPE_LABEL,
  ChannelFieldsEditor,
  ChannelFormState,
  ChannelType,
  TG_MODE_LABEL,
  TgMode,
  channelFormCanSubmit,
  channelFormToPayload,
} from '@/components/channel-fields-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';

export interface Pixel {
  id: string;
  platform: 'FACEBOOK' | 'TIKTOK';
  pixelId: string;
  label: string | null;
  isActive: boolean;
  // Не секрет в смысле accessToken (обычный код Meta, и так виден в её интерфейсе), отдаётся как
  // есть — запрос пользователя 2026-07-29: нужен для индикатора "тестовый режим" и редактирования
  // (раньше после создания пикселя изменить/убрать его было вообще неоткуда через интерфейс).
  testEventCode: string | null;
  // Автор (запрос пользователя 2026-08-03) — null у пикселей без резолвящегося создателя.
  createdBy: { id: string; firstName: string; lastName: string | null } | null;
}

export interface ChannelSummary {
  id: string;
  type: string;
  isActive: boolean;
  lastError: string | null;
  tgMode: TgMode | null;
  tgBotUsername: string | null;
  tgChannelUsername: string | null;
  tgPersonalUsername: string | null;
  tgBotFirstName: string | null;
  tgChannelTitle: string | null;
  tgChannelMembersCount: number | null;
  tgAvatarFileId: string | null;
  webhookStale: boolean;
  websiteUrl: string | null;
  websiteFaviconUrl: string | null;
}

// Полная карточка канала — подтягивается отдельным запросом (GET /channels/:id) только при
// открытии редактирования/раскрытии токена, а не в общем списке проекта: tgBotToken — секрет,
// его не нужно гонять в каждом ответе /projects/:id.
interface ChannelFull extends ChannelSummary {
  projectId: string;
  name: string;
  tgBotToken: string | null;
  tgChannelId: string | null;
  tgWelcomeMessage: string | null;
  wa360Token: string | null;
  igPageId: string | null;
  igAccessToken: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  timezone: string;
  allowedDomains: string[];
  channel: ChannelSummary | null;
  pixels: Pixel[];
  linkParamMap: Record<string, string> | null;
  disabledTrackingEvents: string[];
}

// Все возможные значения вкладки — используется и для валидации ?tab= из URL (запрос
// пользователя 2026-07-27: "при обновлении страницы слетает вкладка"), и как fallback.
// 'operators' — 2026-07-31, см. OperatorsTab ниже.
export const SETTINGS_TABS = ['general', 'channels', 'bot', 'personal', 'pixels', 'pixel-logs', 'events', 'integration', 'operators', 'danger'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function readTabFromSearchParams(params: URLSearchParams): SettingsTab {
  const tab = params.get('tab');
  return (SETTINGS_TABS as readonly string[]).includes(tab || '') ? (tab as SettingsTab) : 'general';
}

export function GeneralTab({ project }: { project: Project }) {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [timezone, setTimezone] = useState(project.timezone);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/projects/${id}`, { name, description: description || undefined, timezone }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', id] }),
  });

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="general-name">Название</Label>
          <Input id="general-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="general-description">Описание</Label>
          <Textarea
            id="general-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <TimezoneInput id="general-timezone" value={timezone} onChange={setTimezone} />
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Сохраняем...' : 'Сохранить'}
        </Button>
      </CardContent>
    </Card>
  );
}

// 1:1 с 2026-07-02 — у проекта ровно один канал, выбранный при создании (см.
// /projects/new). Здесь его можно только редактировать/деактивировать/переподключить —
// нет "добавить ещё канал", это больше не отдельное действие.
export function ChannelsTab({ projectId, channel }: { projectId: string; channel: Project['channel'] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const deactivateChannel = useMutation({
    mutationFn: (channelId: string) => api.delete(`/channels/${channelId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  const reactivateChannel = useMutation({
    mutationFn: (channelId: string) => api.post(`/channels/${channelId}/reactivate`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  if (!channel) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-red-500">
          У проекта нет канала — это не должно происходить в норме, обратитесь в поддержку.
        </CardContent>
      </Card>
    );
  }

  const title = channel.tgChannelTitle || channel.tgBotFirstName;
  const handle = channel.tgChannelUsername || channel.tgBotUsername || channel.tgPersonalUsername;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {/* TELEGRAM всегда, WEBSITE — только если фавиконка реально нашлась (запрос
                  пользователя 2026-09-03) — hasChannelAvatar сама вернёт false, если её нет,
                  но фолбэк-буква тогда всё равно должна отрисоваться, поэтому условие шире,
                  чем просто hasChannelAvatar. */}
              {(channel.type === 'TELEGRAM' || channel.type === 'WEBSITE') && (
                <ChannelAvatar
                  channelId={channel.id}
                  hasAvatar={hasChannelAvatar(channel)}
                  fallbackLetter={title || handle || channel.type}
                />
              )}
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={channel.isActive ? 'outline' : 'destructive'}>
                    {CHANNEL_TYPE_LABEL[channel.type as ChannelType] ?? channel.type}
                  </Badge>
                  {channel.type === 'TELEGRAM' && channel.tgMode && (
                    <Badge variant="secondary" className="font-normal">
                      {TG_MODE_LABEL[channel.tgMode]}
                    </Badge>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {channel.isActive ? 'Активен' : 'Отключён'}
                  </span>
                </div>
                {(title || handle) && (
                  <div className="text-sm">
                    {title && <span className="font-medium">{title}</span>}
                    {handle && (
                      <a
                        href={`https://t.me/${handle.replace(/^@/, '')}`}
                        target="_blank"
                        rel="noopener"
                        className="text-muted-foreground ml-1.5 hover:underline"
                      >
                        @{handle.replace(/^@/, '')}
                      </a>
                    )}
                    {channel.tgChannelMembersCount != null && (
                      <span className="text-muted-foreground ml-1.5 inline-flex items-center gap-0.5">
                        <Users className="w-3 h-3" /> {channel.tgChannelMembersCount}
                      </span>
                    )}
                  </div>
                )}
                {channel.type === 'WEBSITE' && (
                  <div className="text-sm">
                    {channel.websiteUrl ? (
                      <a href={channel.websiteUrl} target="_blank" rel="noopener" className="hover:underline">
                        {channel.websiteUrl}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">Адрес сайта не указан</span>
                    )}
                  </div>
                )}
                {!channel.isActive && channel.lastError && (
                  <p className="text-xs text-red-500 max-w-md">{channel.lastError}</p>
                )}
                {channel.isActive && channel.webhookStale && (
                  <p className="text-xs text-amber-600 max-w-md">
                    Нет вебхуков от Telegram — попробуйте переподключить канал
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="w-4 h-4" />
              </Button>
              {(!channel.isActive || channel.webhookStale) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reactivateChannel.mutate(channel.id)}
                  disabled={reactivateChannel.isPending}
                >
                  {channel.type === 'WEBSITE' ? 'Проверить' : 'Переподключить'}
                </Button>
              )}
              {channel.isActive && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => deactivateChannel.mutate(channel.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <EditChannelDialog
        channelId={editing ? channel.id : null}
        projectId={projectId}
        onClose={() => setEditing(false)}
      />
    </div>
  );
}

function EditChannelDialog({
  channelId,
  projectId,
  onClose,
}: {
  channelId: string | null;
  projectId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ChannelFormState | null>(null);
  const [error, setError] = useState('');

  const { data: full, isLoading } = useQuery({
    queryKey: ['channel', channelId],
    queryFn: async () => (await api.get<ChannelFull>(`/channels/${channelId}`)).data,
    enabled: !!channelId,
  });

  // Сбрасываем/заполняем форму при каждой смене подгруженных данных — ключевано на `full`,
  // не на пустом form===null: иначе переключение на другой канал без явного закрытия диалога
  // (редактирование открыто, кликнули "Редактировать" у другой строки) оставило бы старые
  // значения в полях до следующего ручного close().
  useEffect(() => {
    if (!full) {
      setForm(null);
      return;
    }
    setForm({
      type: full.type as ChannelType,
      name: full.name,
      tgMode: full.tgMode || 'BOT_DIRECT',
      botToken: full.tgBotToken || '',
      channelId: full.tgChannelId || '',
      channelUsername: full.tgChannelUsername || '',
      personalUsername: full.tgPersonalUsername || '',
      wa360Token: full.wa360Token || '',
      igPageId: full.igPageId || '',
      igAccessToken: full.igAccessToken || '',
      websiteUrl: full.websiteUrl || '',
    });
  }, [full]);

  const close = () => {
    onClose();
    setForm(null);
    setError('');
  };

  const save = useMutation({
    mutationFn: () => api.patch(`/channels/${channelId}`, channelFormToPayload(form!)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['channel-avatar', channelId] });
      close();
    },
    onError: (err) =>
      setError(
        (isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить канал',
      ),
  });

  return (
    <Dialog open={!!channelId} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Редактировать канал</DialogTitle>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
        {form && (
          <div className="space-y-3">
            <ChannelFieldsEditor value={form} onChange={setForm} lockType secretsRevealable />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <Button
                onClick={() => save.mutate()}
                disabled={!channelFormCanSubmit(form) || save.isPending}
              >
                {save.isPending ? 'Сохраняем...' : 'Сохранить'}
              </Button>
              <Button variant="ghost" onClick={close}>
                Отмена
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const PLATFORM_LABEL: Record<Pixel['platform'], string> = {
  FACEBOOK: 'Facebook',
  TIKTOK: 'TikTok',
};

// Мягкая проверка формата — Meta всегда показывает код теста в виде TEST + цифры на странице
// Test Events. Намеренно не блокирует отправку формы (это предупреждение, не ошибка) — Meta
// может сменить формат, и жёсткая валидация тогда ошибочно блокировала бы реально верный код.
const TEST_EVENT_CODE_PATTERN = /^TEST\d+$/i;

// Зеркалит apps/api/.../pixels/dto/test-pixel-event.dto.ts TESTABLE_EVENT_NAMES (нет общего
// пакета между apps/web и apps/api в этом монорепо, тот же принцип, что у tracking-events.ts).
const TESTABLE_EVENT_NAMES = ['PageView', 'Lead', 'Subscribe', 'Unsubscribe', 'Dialogue', 'Purchase', 'InitiateCheckout'];

// Дропдаун Chat/Website убран (запрос пользователя 2026-07-31: "для проверки убери дропдаун с
// chat website, пусть будет всегда website") — actionSource теперь всегда захардкожен как
// 'website' в обеих мутациях (testEvent/editTestEvent) ниже.

interface PixelTestEventResult {
  success: boolean;
  error?: string;
  warning?: string;
  // requestPayload/testEventCode (запрос пользователя 2026-07-29: "покажи весь запрос, так как
  // на страницу тестовых ивентов ничего не появилось") — раньше показывался только ответ
  // платформы, не сам отправленный запрос, из-за чего нельзя было проверить, действительно ли
  // test_event_code реально ушёл (он живёт вне requestPayload по формату реального запроса).
  requestPayload?: unknown;
  responsePayload?: unknown;
  testEventCode?: string | null;
  // Готовая curl-команда с реальным access_token (запрос пользователя 2026-07-29/30: "покажи не
  // только тело запроса а весь запрос с курл... чтобы сразу в cmd отправить").
  curlCommand?: string;
}

export function PixelsTab({
  projectId,
  pixels,
  linkParamMap,
}: {
  projectId: string;
  pixels: Pixel[];
  linkParamMap: Record<string, string> | null;
}) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [showAddForm, setShowAddForm] = useState(false);
  const [platform, setPlatform] = useState<Pixel['platform']>('FACEBOOK');
  const [label, setLabel] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [testEventCode, setTestEventCode] = useState('');
  const [testEventName, setTestEventName] = useState('Subscribe');
  const [error, setError] = useState('');

  const resetForm = () => {
    setShowAddForm(false);
    setPlatform('FACEBOOK');
    setLabel('');
    setPixelId('');
    setAccessToken('');
    setTestEventCode('');
    testEvent.reset();
  };

  const testEvent = useMutation({
    mutationFn: async () =>
      (
        await api.post<PixelTestEventResult>('/pixels/test-event', {
          projectId,
          platform,
          pixelId,
          accessToken,
          testEventCode: platform === 'FACEBOOK' ? testEventCode || undefined : undefined,
          eventName: testEventName,
          actionSource: 'website',
        })
      ).data,
  });

  const addPixel = useMutation({
    mutationFn: () =>
      api.post('/pixels', {
        projectId,
        platform,
        label: label || undefined,
        pixelId,
        accessToken,
        testEventCode: platform === 'FACEBOOK' ? testEventCode || undefined : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      resetForm();
    },
    onError: (err) =>
      setError(
        (isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось добавить пиксель',
      ),
  });

  const deactivatePixel = useMutation({
    mutationFn: (pixelId: string) => api.delete(`/pixels/${pixelId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  // Редактирование пикселя после создания (запрос пользователя 2026-07-29: "чтобы всё работало
  // идеально" при запуске реальной рекламы) — раньше такой возможности не было вообще: единственный
  // способ убрать/поменять Test Event Code — удалить пиксель и создать заново, теряя его историю.
  // Особенно важно для test_event_code: события с ним НИКОГДА не попадают в реальную статистику
  // пикселя/оптимизацию рекламы, только в тестовую вкладку Meta — забытый после отладки код молча
  // отправлял бы 100% реальных конверсий мимо кампании.
  const [editingPixelId, setEditingPixelId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editAccessToken, setEditAccessToken] = useState('');
  const [editTestEventCode, setEditTestEventCode] = useState('');
  const [editTestEventName, setEditTestEventName] = useState('Subscribe');

  const startEditingPixel = (p: Pixel) => {
    setEditingPixelId(p.id);
    setEditLabel(p.label || '');
    setEditAccessToken('');
    setEditTestEventCode(p.testEventCode || '');
    editTestEvent.reset();
  };

  const updatePixel = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/pixels/${id}`, {
        label: editLabel || null,
        accessToken: editAccessToken || undefined, // пусто — не менять текущий токен
        testEventCode: editTestEventCode || null, // пусто — явно очистить (не "не менять")
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setEditingPixelId(null);
    },
  });

  // Тест при редактировании (запрос пользователя 2026-07-29: "сделай чтобы во время
  // редактирования тоже можно было отправлять тестовые запросы") — использует уже сохранённый
  // accessToken пикселя (клиенту он никогда не отдаётся обратно), с оверрайдом ещё не
  // сохранённых правок формы: accessToken пусто = "как сейчас в БД", testEventCode передаётся
  // всегда (даже пустым) — тестирует то, что реально видно в форме прямо сейчас, а не то, что
  // сохранено.
  const editTestEvent = useMutation({
    mutationFn: async (pixelId: string) =>
      (
        await api.post<PixelTestEventResult>(`/pixels/${pixelId}/test-event`, {
          eventName: editTestEventName,
          accessToken: editAccessToken || undefined,
          testEventCode: editTestEventCode,
          actionSource: 'website',
        })
      ).data,
  });

  return (
    // Параметры трекинг-ссылки — отдельная правая колонка на широких экранах (запрос
    // пользователя 2026-07-20: раньше блок был внизу вкладки и терялся, когда пикселей много,
    // до него приходилось долго скроллить). На узких экранах колонки складываются в одну —
    // блок параметров идёт первым (order-1), чтобы быть видимым сразу, без скролла мимо списка.
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_440px] gap-4 items-start">
      <div className="order-2 lg:order-1 space-y-4">
        <Card>
          <CardContent className="p-5 space-y-3">
            {pixels.length === 0 && <p className="text-sm text-muted-foreground">Пиксели не привязаны.</p>}
            {pixels.map((pixel) => (
              <div key={pixel.id} className="py-2 border-b last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Badge className="shrink-0" variant={pixel.isActive ? 'outline' : 'destructive'}>
                      {PLATFORM_LABEL[pixel.platform]}
                    </Badge>
                    <span className="text-sm truncate" title={pixel.label || pixel.pixelId}>
                      {pixel.label || pixel.pixelId}
                    </span>
                    <span className="text-sm text-muted-foreground shrink-0">
                      {pixel.isActive ? 'Активен' : 'Отключён'}
                    </span>
                    {/* Запрос пользователя 2026-07-29 — видно с первого взгляда, что пиксель
                        сейчас шлёт события в тестовую вкладку Meta, а не в реальную статистику. */}
                    {pixel.testEventCode && (
                      <Badge variant="secondary" className="shrink-0 text-amber-700 dark:text-amber-400" title={`Test Event Code: ${pixel.testEventCode}`}>
                        Тестовый режим
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {pixel.isActive && hasPermission(user, projectId, 'PIXELS_EDIT') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => (editingPixelId === pixel.id ? setEditingPixelId(null) : startEditingPixel(pixel))}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                    {pixel.isActive && hasPermission(user, projectId, 'PIXELS_DELETE') && (
                      <Button size="sm" variant="ghost" onClick={() => deactivatePixel.mutate(pixel.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
                {/* Автор (запрос пользователя 2026-08-03) */}
                {pixel.createdBy && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Создал: {pixel.createdBy.firstName} {pixel.createdBy.lastName ?? ''}
                  </p>
                )}
                {editingPixelId === pixel.id && (
                  <div className="mt-2 space-y-2.5 pl-1">
                    <div className="space-y-1.5">
                      <Label htmlFor={`edit-label-${pixel.id}`}>Название (внутреннее)</Label>
                      <Input id={`edit-label-${pixel.id}`} value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`edit-token-${pixel.id}`}>Новый Access Token (пусто — не менять)</Label>
                      <Input
                        id={`edit-token-${pixel.id}`}
                        type="password"
                        value={editAccessToken}
                        onChange={(e) => setEditAccessToken(e.target.value)}
                      />
                    </div>
                    {pixel.platform === 'FACEBOOK' && (
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-tec-${pixel.id}`}>Test Event Code (пусто — убрать, реклама пойдёт в реальную статистику)</Label>
                        <Input id={`edit-tec-${pixel.id}`} value={editTestEventCode} onChange={(e) => setEditTestEventCode(e.target.value)} />
                      </div>
                    )}

                    {/* Проверка ивента прямо во время редактирования (запрос пользователя
                        2026-07-29) — тестирует ровно то, что сейчас видно в форме (включая ещё
                        не сохранённые правки), не обязательно нажимать "Сохранить" сначала. */}
                    <div className="space-y-1.5 pt-1 border-t">
                      <Label htmlFor={`edit-test-name-${pixel.id}`}>Проверка ивента</Label>
                      <div className="flex flex-wrap gap-2">
                        <Select value={editTestEventName} onValueChange={(v) => v && setEditTestEventName(v)}>
                          <SelectTrigger id={`edit-test-name-${pixel.id}`} className="flex-1 min-w-[140px]">
                            <SelectValue>{(v: string) => v}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {TESTABLE_EVENT_NAMES.map((name) => (
                              <SelectItem key={name} value={name}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => editTestEvent.mutate(pixel.id)}
                          disabled={editTestEvent.isPending}
                        >
                          {editTestEvent.isPending ? 'Отправляем...' : 'Отправить тест'}
                        </Button>
                      </div>
                      {pixel.platform === 'FACEBOOK' && !editTestEventCode && (
                        <p className="text-xs text-amber-600">
                          Без Test Event Code тестовое событие уйдёт как настоящее и попадёт в статистику пикселя.
                        </p>
                      )}
                      {editTestEvent.data && (
                        <div className="space-y-2 pt-1">
                          <p className={`text-sm ${editTestEvent.data.success ? 'text-emerald-600' : 'text-red-500'}`}>
                            {editTestEvent.data.success
                              ? editTestEvent.data.warning
                                ? `⚠ ${editTestEvent.data.warning}`
                                : 'Событие отправлено и принято платформой.'
                              : `Ошибка: ${editTestEvent.data.error}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Test Event Code: {editTestEvent.data.testEventCode || 'не использован (уйдёт как настоящее событие)'}
                          </p>
                          {!!editTestEvent.data.curlCommand && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">
                                Полный запрос (curl, с реальным access_token — можно вставить прямо в cmd):
                              </p>
                              <CodeBlock code={editTestEvent.data.curlCommand} />
                            </div>
                          )}
                          {!!editTestEvent.data.requestPayload && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Тело запроса:</p>
                              <CodeBlock code={JSON.stringify(editTestEvent.data.requestPayload, null, 2)} />
                            </div>
                          )}
                          {!!editTestEvent.data.responsePayload && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Ответ платформы:</p>
                              <CodeBlock code={JSON.stringify(editTestEvent.data.responsePayload, null, 2)} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => updatePixel.mutate(pixel.id)} disabled={updatePixel.isPending}>
                        {updatePixel.isPending ? 'Сохраняем...' : 'Сохранить'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingPixelId(null)}>
                        Отмена
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {!showAddForm && hasPermission(user, projectId, 'PIXELS_CREATE') && (
          <Button variant="outline" onClick={() => setShowAddForm(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Добавить пиксель
          </Button>
        )}

        {showAddForm && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Новый пиксель</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Проект не привязан к одной платформе — можно добавить сколько угодно пикселей любых
                платформ одновременно (несколько FB-аккаунтов, FB + TikTok и т.д.). Каждое событие
                уйдёт во все активные пиксели проекта.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="pixel-platform">Платформа</Label>
                <Select
                  value={platform}
                  onValueChange={(v) => v && setPlatform(v as Pixel['platform'])}
                >
                  <SelectTrigger id="pixel-platform">
                    <SelectValue>{(v: Pixel['platform']) => PLATFORM_LABEL[v]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FACEBOOK">Facebook</SelectItem>
                    <SelectItem value="TIKTOK">TikTok</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pixel-label">Название (внутреннее, опционально)</Label>
                <Input
                  id="pixel-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Например: основной аккаунт"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pixel-id">Pixel ID</Label>
                <Input id="pixel-id" value={pixelId} onChange={(e) => setPixelId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pixel-access-token">Access Token</Label>
                <Input
                  id="pixel-access-token"
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                />
              </div>
              {platform === 'FACEBOOK' && (
                <div className="space-y-1.5">
                  <Label htmlFor="pixel-test-event-code">
                    Test Event Code (опционально, для отладки CAPI)
                  </Label>
                  <Input
                    id="pixel-test-event-code"
                    value={testEventCode}
                    onChange={(e) => setTestEventCode(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Скопируйте код со страницы Meta Events Manager → вкладка &quot;Тестовые
                    события&quot; (обычно вида TEST1234) — события с этим кодом будут видны там же в
                    реальном времени, не влияя на статистику пикселя.
                  </p>
                  {testEventCode && !TEST_EVENT_CODE_PATTERN.test(testEventCode) && (
                    <p className="text-xs text-amber-600">
                      Обычно код Meta выглядит как TEST + цифры (например, TEST1234) — проверьте,
                      что скопировали верно.
                    </p>
                  )}
                </div>
              )}
              {/* Проверка ивента (запрос пользователя 2026-07-29: "для проверки ивента пусть
                  будет выборка event") — шлёт разовое реальное событие уже введёнными выше
                  pixelId/accessToken/testEventCode, ДО сохранения пикселя в БД, чтобы сразу
                  увидеть, доходит ли вообще. Без testEventCode (Facebook) это уйдёт как
                  настоящее событие в статистику пикселя — предупреждаем, не блокируем. */}
              <div className="space-y-1.5 pt-1 border-t">
                <Label htmlFor="pixel-test-event-name">Проверка ивента</Label>
                <div className="flex flex-wrap gap-2">
                  <Select value={testEventName} onValueChange={(v) => v && setTestEventName(v)}>
                    <SelectTrigger id="pixel-test-event-name" className="flex-1 min-w-[140px]">
                      <SelectValue>{(v: string) => v}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TESTABLE_EVENT_NAMES.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* size="sm" — раньше отсутствовал (запрос пользователя 2026-07-31: "кнопка
                      отправить тест больше чем дропдауны рядом с ней"). */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => testEvent.mutate()}
                    disabled={!pixelId || !accessToken || testEvent.isPending}
                  >
                    {testEvent.isPending ? 'Отправляем...' : 'Отправить тест'}
                  </Button>
                </div>
                {platform === 'FACEBOOK' && !testEventCode && (
                  <p className="text-xs text-amber-600">
                    Без Test Event Code тестовое событие уйдёт как настоящее и попадёт в статистику пикселя.
                  </p>
                )}
                {testEvent.data && (
                  <div className="space-y-2 pt-1">
                    <p className={`text-sm ${testEvent.data.success ? 'text-emerald-600' : 'text-red-500'}`}>
                      {testEvent.data.success
                        ? testEvent.data.warning
                          ? `⚠ ${testEvent.data.warning}`
                          : 'Событие отправлено и принято платформой.'
                        : `Ошибка: ${testEvent.data.error}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Test Event Code: {testEvent.data.testEventCode || 'не использован (уйдёт как настоящее событие)'}
                    </p>
                    {!!testEvent.data.curlCommand && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Полный запрос (curl, с реальным access_token — можно вставить прямо в cmd):
                        </p>
                        <CodeBlock code={testEvent.data.curlCommand} />
                      </div>
                    )}
                    {!!testEvent.data.requestPayload && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Тело запроса:</p>
                        <CodeBlock code={JSON.stringify(testEvent.data.requestPayload, null, 2)} />
                      </div>
                    )}
                    {!!testEvent.data.responsePayload && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Ответ платформы:</p>
                        <CodeBlock code={JSON.stringify(testEvent.data.responsePayload, null, 2)} />
                      </div>
                    )}
                  </div>
                )}
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex gap-2">
                <Button
                  onClick={() => addPixel.mutate()}
                  disabled={!pixelId || !accessToken || addPixel.isPending}
                >
                  {addPixel.isPending ? 'Добавляем...' : 'Добавить'}
                </Button>
                <Button variant="ghost" onClick={resetForm}>
                  Отмена
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="order-1 lg:order-2">
        <LinkParamsCard projectId={projectId} linkParamMap={linkParamMap} />
      </div>
    </div>
  );
}

// Кастомные имена query-параметров трекинг-ссылки лендинга (запрос пользователя 2026-07-04,
// "получить ссылку" с пикселем + рекламными макросами Facebook/TikTok) — у всех клиентов
// платформы одинаковые ?pixel=&ad_id= легко палятся спай-сервисами конкурентов, поэтому имена
// переопределяемые per-project. Значение макроса ({{ad.id}} и т.п.) от имени параметра не
// зависит — Facebook подставляет его по содержимому, а не по названию ключа в URL.
function LinkParamsCard({
  projectId,
  linkParamMap,
}: {
  projectId: string;
  linkParamMap: Record<string, string> | null;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() => resolveParamMap(linkParamMap));
  const [error, setError] = useState('');

  useEffect(() => {
    setValues(resolveParamMap(linkParamMap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkParamMap]);

  const save = useMutation({
    mutationFn: () => api.patch(`/projects/${projectId}`, { linkParamMap: values }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setError('');
    },
    onError: (err) =>
      setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить'),
  });

  const invalid = Object.values(values).some((v) => !LINK_PARAM_NAME_REGEX.test(v));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Параметры трекинг-ссылки</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Имена query-параметров ссылки, которую выдаёт кнопка «Получить ссылку» на лендинге.
          Одинаковые имена у всех клиентов платформы легко распознаются спай-сервисами конкурентов —
          здесь можно задать свои.
        </p>
        {LINK_PARAM_FIELDS.map((field) => (
          <div key={field.key} className="space-y-1">
            <Label htmlFor={`link-param-${field.key}`} className="text-sm">
              {field.label}
            </Label>
            <Input
              id={`link-param-${field.key}`}
              value={values[field.key] ?? field.default}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              placeholder={field.default}
            />
          </div>
        ))}
        {invalid && (
          <p className="text-sm text-red-500">Разрешены только буквы, цифры и подчёркивание.</p>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button onClick={() => save.mutate()} disabled={invalid || save.isPending}>
          {save.isPending ? 'Сохраняем...' : 'Сохранить'}
        </Button>
      </CardContent>
    </Card>
  );
}

// PageView/Lead исключены из выборки на бэкенде безусловно (запрос пользователя 2026-07-29,
// "убери со страницы логов пикселей pageview и lead") — убраны и из фильтра тут же, фильтр по
// событию, которого не бывает в списке, был бы бессмысленным.
const EVENT_NAME_OPTIONS = [
  'Subscribe',
  'Unsubscribe',
  'Dialogue',
  'Purchase',
  'InitiateCheckout',
  'Click',
];
const ALL_VALUE = '__all__';
const STATUS_FILTER_LABEL: Record<string, string> = { [ALL_VALUE]: 'Любой статус', sent: 'Отправлено', error: 'Ошибка' };

interface PixelLogEntry {
  id: string;
  status: string;
  error: string | null;
  externalEventId: string | null;
  sentAt: string;
  requestPayload: unknown;
  responsePayload: Record<string, unknown> | null;
  httpStatus: number | null;
  // Только для OWNER (запрос пользователя 2026-07-29) — готовая curl-команда с настоящим
  // access_token пикселя, для вставки прямо в терминал. Бэкенд решает по роли, отдаёт ли это
  // поле вообще — здесь просто рендерим, если оно есть.
  curlCommand?: string;
  pixel: { id: string; platform: string; label: string | null; pixelId: string };
  event: {
    eventName: string;
    eventTime: string;
    payload: Record<string, unknown>;
    adId: string | null;
    adName: string | null;
    campaignId: string | null;
    campaignName: string | null;
  };
}

interface PixelLogsResponse {
  items: PixelLogEntry[];
  total: number;
  page: number;
  totalPages: number;
}

// Логи доставки событий в пиксели (запрос пользователя 2026-07-04) — "что отправлялось
// платформе трафика и статус". Данные уже существовали (TrackingEventDelivery пишется на
// каждую пару событие+пиксель в TrackingProcessor), тут впервые показываются в UI.
// Персистентность фильтров в URL (запрос пользователя 2026-07-29: "при обновлении страницы
// сохрани выбранные фильтры") — тот же паттерн, что уже есть у вкладки настроек (readTabFromSearchParams
// выше) и у PeriodSelector на странице проекта: читаем один раз при монтировании через
// useState(() => ...), не useEffect, чтобы не мигать дефолтом перед переключением на реальный
// фильтр. Свои query-параметры (logPixel/logStatus/logEvent), не пересекаются с ?tab= родителя.
function readFilterFromSearchParams(params: URLSearchParams, key: string): string {
  return params.get(key) || ALL_VALUE;
}

export function PixelLogsTab({ projectId, pixels }: { projectId: string; pixels: Pixel[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [pixelFilter, setPixelFilterState] = useState(() => readFilterFromSearchParams(searchParams, 'logPixel'));
  const [statusFilter, setStatusFilterState] = useState(() => readFilterFromSearchParams(searchParams, 'logStatus'));
  const [eventFilter, setEventFilterState] = useState(() => readFilterFromSearchParams(searchParams, 'logEvent'));
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const updateFilterParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value === ALL_VALUE) params.delete(key); else params.set(key, value);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };
  const setPixelFilter = (v: string) => {
    setPixelFilterState(v);
    updateFilterParam('logPixel', v);
  };
  const setStatusFilter = (v: string) => {
    setStatusFilterState(v);
    updateFilterParam('logStatus', v);
  };
  const setEventFilter = (v: string) => {
    setEventFilterState(v);
    updateFilterParam('logEvent', v);
  };

  const { data } = useQuery({
    queryKey: ['project', projectId, 'pixel-logs', page, pixelFilter, statusFilter, eventFilter],
    queryFn: async () =>
      (
        await api.get<PixelLogsResponse>(`/projects/${projectId}/pixel-logs`, {
          params: {
            page,
            pixelId: pixelFilter === ALL_VALUE ? undefined : pixelFilter,
            status: statusFilter === ALL_VALUE ? undefined : statusFilter,
            eventName: eventFilter === ALL_VALUE ? undefined : eventFilter,
          },
        })
      ).data,
  });

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select
          value={pixelFilter}
          onValueChange={(v) => {
            if (v) {
              setPixelFilter(v);
              resetPage();
            }
          }}
        >
          <SelectTrigger className="w-48">
            {/* Баг-репорт пользователя 2026-07-29: "показывает айди... а не сам пиксель" — голый
                <SelectValue /> рендерит сырое value (id пикселя/"sent"/"__all__"), а не подпись
                из SelectItem — тот же баг класса, что уже чинили для темы/платформы (см. Base UI
                Select ниже, PLATFORM_LABEL). Нужна render-функция, сопоставляющая value -> label. */}
            <SelectValue>
              {(v: string) => {
                if (v === ALL_VALUE) return 'Все пиксели';
                const p = pixels.find((px) => px.id === v);
                return p ? `${p.label || p.pixelId} (${PLATFORM_LABEL[p.platform]})` : v;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Все пиксели</SelectItem>
            {pixels.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label || p.pixelId} ({PLATFORM_LABEL[p.platform]})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            if (v) {
              setStatusFilter(v);
              resetPage();
            }
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue>{(v: string) => STATUS_FILTER_LABEL[v] ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Любой статус</SelectItem>
            <SelectItem value="sent">Отправлено</SelectItem>
            <SelectItem value="error">Ошибка</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={eventFilter}
          onValueChange={(v) => {
            if (v) {
              setEventFilter(v);
              resetPage();
            }
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue>{(v: string) => (v === ALL_VALUE ? 'Любое событие' : v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Любое событие</SelectItem>
            {EVENT_NAME_OPTIONS.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {!data?.items.length ? (
            <p className="p-5 text-sm text-muted-foreground">Логов пока нет.</p>
          ) : (
            <div className="divide-y">
              {data.items.map((log) => (
                <div key={log.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId((cur) => (cur === log.id ? null : log.id))}
                    className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-left hover:bg-muted"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant={log.status === 'sent' ? 'outline' : 'destructive'}>
                        {log.status === 'sent' ? 'Отправлено' : 'Ошибка'}
                      </Badge>
                      <span className="font-medium">{log.event.eventName}</span>
                      <span className="text-muted-foreground truncate">
                        {log.pixel.label || log.pixel.pixelId} (
                        {PLATFORM_LABEL[log.pixel.platform as Pixel['platform']]})
                      </span>
                    </div>
                    <span className="text-muted-foreground shrink-0">
                      {new Date(log.sentAt).toLocaleString('ru-RU')}
                    </span>
                  </button>
                  {expandedId === log.id && (
                    <div className="px-4 pb-4 space-y-3 text-xs">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          {PLATFORM_LABEL[log.pixel.platform as Pixel['platform']]}
                        </span>
                        <span>ID: {log.pixel.pixelId}</span>
                        <span>{new Date(log.sentAt).toLocaleString('ru-RU')}</span>
                      </div>
                      {log.error && <p className="text-red-500">Ошибка: {log.error}</p>}
                      {log.externalEventId && (
                        <p className="text-muted-foreground">
                          ID на стороне платформы: {log.externalEventId}
                        </p>
                      )}
                      {(log.event.campaignId || log.event.adId) && (
                        <p className="text-muted-foreground">
                          Кампания: {log.event.campaignName || log.event.campaignId || '—'}
                          {log.event.adId
                            ? ` / Объявление: ${log.event.adName || log.event.adId}`
                            : ''}
                        </p>
                      )}
                      {log.requestPayload || log.responsePayload ? (
                        <>
                          <div>
                            <p className="text-muted-foreground mb-1">Payload (отправленные данные)</p>
                            <CodeBlock code={JSON.stringify(log.requestPayload ?? '—', null, 4)} />
                          </div>
                          <div>
                            <p className="text-muted-foreground mb-1">Response (ответ сервера)</p>
                            <CodeBlock code={JSON.stringify(log.responsePayload ?? '—', null, 4)} />
                          </div>
                          <p className="text-muted-foreground">
                            HTTP Status: {log.httpStatus ?? '—'}
                          </p>
                          {log.curlCommand && (
                            <div>
                              <p className="text-muted-foreground mb-1">
                                Полный запрос (curl, с реальным access_token — только для Owner)
                              </p>
                              <CodeBlock code={log.curlCommand} />
                            </div>
                          )}
                        </>
                      ) : (
                        <div>
                          <p className="text-muted-foreground mb-1">
                            Отправленные данные (payload события) — запись до включения полного лога запроса/ответа:
                          </p>
                          <CodeBlock code={JSON.stringify(log.event.payload, null, 4)} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Назад
          </Button>
          <span className="text-sm text-muted-foreground">
            {data.page} / {data.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Далее
          </Button>
        </div>
      )}
    </div>
  );
}

// Свитчи вкл/выкл пересылки события в Facebook/TikTok по типу (запрос пользователя 2026-07-27).
// Сама запись события в CRM (TrackingEvent) не зависит от этого списка — см.
// TrackingService.recordEvent на бэкенде, выключается только внешняя отправка.
export function EventsTab({
  projectId,
  disabledTrackingEvents,
  channelType,
}: {
  projectId: string;
  disabledTrackingEvents: string[];
  channelType?: string;
}) {
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: (next: string[]) => api.patch(`/projects/${projectId}`, { disabledTrackingEvents: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  // Обычный сайт (ChannelType.WEBSITE, запрос пользователя 2026-09-03) — Subscribe/Unsubscribe/
  // Dialogue никогда не срабатывают без мессенджера/бота, показывать переключатели для них
  // нечего. Purchase — единственное автоматическое событие, которое реально фигурирует для сайта
  // (см. TrackingService.resolveOrCreateWebsiteClient).
  const eventTypes = channelType === 'WEBSITE' ? TRACKING_EVENT_TYPES.filter((et) => et.name === 'Purchase') : TRACKING_EVENT_TYPES;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Отправка событий в рекламные платформы</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground mb-3">
          Выключенные события по-прежнему видны в CRM и в логах, но не отправляются в Facebook/TikTok.
        </p>
        {eventTypes.map((eventType) => {
          const isEnabled = !disabledTrackingEvents.includes(eventType.name);
          return (
            <div
              key={eventType.name}
              className="flex items-start justify-between gap-4 py-2.5 border-b last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{eventType.label}</p>
                <p className="text-xs text-muted-foreground">{eventType.description}</p>
              </div>
              <Switch
                checked={isEnabled}
                disabled={toggle.isPending}
                onCheckedChange={(checked) => {
                  const next = checked
                    ? disabledTrackingEvents.filter((n) => n !== eventType.name)
                    : [...disabledTrackingEvents, eventType.name];
                  toggle.mutate(next);
                }}
                className="shrink-0 mt-0.5"
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function IntegrationTab({
  projectId,
  allowedDomains,
  channelType,
}: {
  projectId: string;
  allowedDomains: string[];
  channelType?: string;
}) {
  const queryClient = useQueryClient();
  const [showSecret, setShowSecret] = useState(false);
  const [domainsText, setDomainsText] = useState(allowedDomains.join('\n'));

  const { data: snippet } = useQuery({
    queryKey: ['project', projectId, 'snippet'],
    queryFn: async () =>
      (await api.get(`/projects/${projectId}/snippet`)).data as {
        snippet: string;
        apiExample: string;
        phpExample: string;
        pythonExample: string;
        publicToken: string;
      },
  });

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () =>
      (await api.get<Project & { secretKey: string }>(`/projects/${projectId}`)).data,
  });

  const regenerate = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/tokens`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'snippet'] });
    },
  });

  const saveDomains = useMutation({
    mutationFn: () =>
      api.patch(`/projects/${projectId}`, {
        allowedDomains: domainsText
          .split('\n')
          .map((d) => d.trim())
          .filter(Boolean),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  return (
    <div className="space-y-4">
      {channelType === 'WEBSITE' && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">Как подключить сайт</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="text-sm space-y-2 list-decimal pl-4">
              <li>Скопируйте код ниже (карточка «JS-сниппет»).</li>
              <li>Вставьте его в код сайта прямо перед закрывающим тегом <code>&lt;/head&gt;</code> — на всех страницах, где нужна статистика.</li>
              <li>
                Откройте вкладку «Каналы» и нажмите «Проверить» — канал станет «Активен» только
                после того, как мы реально найдём этот код на странице.
              </li>
              <li>Для отправки покупок надёжнее использовать серверный способ ниже (карточка «Серверная интеграция») — он не блокируется рекламными блокировщиками браузера.</li>
            </ol>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ключи доступа</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="public-token">Public Token</Label>
            <p className="text-xs text-muted-foreground">Для браузерного скрипта (JS-сниппет ниже) — публичный, его видно в исходном коде любой страницы, это нормально.</p>
            <div className="flex gap-2">
              <Input id="public-token" readOnly value={snippet?.publicToken || ''} />
              <Button
                size="icon"
                variant="outline"
                onClick={() => copyToClipboard(snippet?.publicToken || '')}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {/* Отдельное явное поле (запрос пользователя 2026-09-03: "для сервера и для публичного
              скрипта стоят разные id проекта... не работает, показывает project not found") —
              этот id раньше был виден ТОЛЬКО внутри примеров кода серверной интеграции, из-за
              чего его легко перепутать с Public Token выше (оба выглядят как случайная строка).
              Это намеренно РАЗНЫЕ значения: Public Token резолвится в TrackingController.trackEvent
              (публичный SDK-путь), Project ID — в trackServerEvent (подписанный HMAC-путь), два
              разных эндпоинта — использование одного id в примере для другого эндпоинта даёт
              настоящий 404 "Project not found"/"Not Found". */}
          <div className="space-y-1.5">
            <Label htmlFor="project-id">Project ID</Label>
            <p className="text-xs text-muted-foreground">Для серверных вызовов (примеры кода ниже) — вместе с Secret Key. Это ДРУГОЙ id, не Public Token выше — не путайте их местами.</p>
            <div className="flex gap-2">
              <Input id="project-id" readOnly value={project?.id || ''} />
              <Button size="icon" variant="outline" onClick={() => copyToClipboard(project?.id || '')}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="secret-key">Secret Key</Label>
            <div className="flex gap-2">
              <Input
                id="secret-key"
                readOnly
                type={showSecret ? 'text' : 'password'}
                value={project?.secretKey || ''}
              />
              <Button size="icon" variant="outline" onClick={() => setShowSecret((s) => !s)}>
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={() => copyToClipboard(project?.secretKey || '')}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm('Старые ключи перестанут работать немедленно. Продолжить?'))
                regenerate.mutate();
            }}
          >
            Перегенерировать ключи
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Разрешённые домены (CORS)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={domainsText}
            onChange={(e) => setDomainsText(e.target.value)}
            placeholder="example.com&#10;shop.example.com"
            rows={4}
          />
          <Button size="sm" onClick={() => saveDomains.mutate()} disabled={saveDomains.isPending}>
            Сохранить
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">JS-сниппет (вставить в &lt;head&gt; лендинга)</CardTitle>
        </CardHeader>
        <CardContent>
          <CodeBlock code={snippet?.snippet || ''} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Серверная интеграция</CardTitle>
          {channelType === 'WEBSITE' && (
            <p className="text-sm text-muted-foreground">
              Рекомендуем отправлять «Покупку» именно так, с вашего бэкенда после подтверждения
              оплаты — надёжнее, чем из браузера, и не зависит от блокировщиков рекламы.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="node">
            <TabsList>
              <TabsTrigger value="node">Node.js</TabsTrigger>
              <TabsTrigger value="php">PHP</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
            </TabsList>
            <TabsContent value="node">
              <CodeBlock code={snippet?.apiExample || ''} />
            </TabsContent>
            <TabsContent value="php">
              <CodeBlock code={snippet?.phpExample || ''} />
            </TabsContent>
            <TabsContent value="python">
              <CodeBlock code={snippet?.pythonExample || ''} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="relative">
      <pre className="text-xs bg-gray-900 text-gray-100 rounded-lg p-3 pr-10 overflow-x-auto">
        {code}
      </pre>
      <Button
        size="icon"
        variant="ghost"
        className="absolute top-2 right-2 h-7 w-7 text-gray-400 hover:text-white"
        onClick={async () => {
          await copyToClipboard(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      </Button>
    </div>
  );
}

export function DangerTab({ projectId, onArchived }: { projectId: string; onArchived: () => void }) {
  const archive = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}`),
    onSuccess: onArchived,
  });

  return (
    <Card className="border-red-200">
      <CardContent className="p-5 flex items-center justify-between">
        <div>
          <div className="font-medium">Архивировать проект</div>
          <div className="text-sm text-muted-foreground">
            Проект и все данные останутся в системе, но станут недоступны.
          </div>
        </div>
        <Button
          variant="destructive"
          onClick={() => {
            if (confirm('Архивировать проект?')) archive.mutate();
          }}
        >
          Архивировать
        </Button>
      </CardContent>
    </Card>
  );
}

interface ProjectOperator {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  isActive: boolean;
}

// Управление операторами проекта (запрос пользователя 2026-07-31: "админ операторов,
// администратор либо овнер может зайти на проект и добавить активных операторов туда, и пока
// они добавлены в проект как операторы они имеют доступ к их клиентам") — новый
// GET/POST/DELETE /projects/:id/operators на бэкенде, права всегда фиксированный
// DEFAULT_ROLE_PERMISSIONS.OPERATOR (seedDefaultsIfEmpty), без ручной настройки. Видимость
// вкладки самой по себе гейтится в page.tsx (OWNER/ADMIN/OPERATOR_ADMIN/SUPER_ADMIN) — здесь
// уже предполагается, что у пользователя есть доступ.
export function OperatorsTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [search, setSearch] = useState('');

  const { data: operators, isLoading } = useQuery({
    queryKey: ['project-operators', projectId],
    queryFn: async () => (await api.get<ProjectOperator[]>(`/projects/${projectId}/operators`)).data,
  });

  // Company-wide (не сужено до "пересекается с моими проектами") — подтверждено
  // AskUserQuestion 2026-07-31: иначе Оператор-админу неоткуда было бы взять только что
  // созданного оператора с 0 проектов.
  const { data: candidates } = useQuery({
    queryKey: ['project-operator-candidates', projectId],
    queryFn: async () => (await api.get<ProjectOperator[]>(`/projects/${projectId}/operators/candidates`)).data,
    enabled: showAddDialog,
  });

  const add = useMutation({
    mutationFn: (userId: string) => api.post(`/projects/${projectId}/operators`, { userId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-operators', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-operator-candidates', projectId] });
    },
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.delete(`/projects/${projectId}/operators/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-operators', projectId] }),
  });

  const filteredCandidates = candidates?.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${c.firstName} ${c.lastName ?? ''}`.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Операторы с доступом к клиентам этого проекта. Права фиксированные — как только
          оператор добавлен, он сразу видит клиентов и может регистрировать депозиты.
        </p>
        <Button size="sm" onClick={() => setShowAddDialog(true)} className="shrink-0">
          <Plus className="w-4 h-4 mr-1.5" /> Добавить оператора
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
      {!isLoading && !operators?.length && <p className="text-sm text-muted-foreground">Операторов пока нет.</p>}
      {!!operators?.length && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Оператор</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operators.map((op) => (
                  <TableRow key={op.id}>
                    <TableCell>
                      <div className="font-medium">
                        {op.firstName} {op.lastName || ''}
                      </div>
                      <div className="text-xs text-muted-foreground">{op.email}</div>
                    </TableCell>
                    <TableCell>{op.isActive ? <Badge>Активен</Badge> : <Badge variant="secondary">Отключён</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (confirm(`Убрать оператора ${op.email} с этого проекта?`)) remove.mutate(op.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-1.5" /> Убрать
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить оператора</DialogTitle>
          </DialogHeader>
          <Input placeholder="Имя или email..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-72 overflow-y-auto space-y-1">
            {!filteredCandidates?.length && <p className="text-sm text-muted-foreground py-2">Нет доступных операторов.</p>}
            {filteredCandidates?.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={add.isPending}
                onClick={() => add.mutate(c.id)}
                className="w-full flex items-center justify-between gap-2 rounded-md border p-2.5 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
              >
                <div>
                  <div className="font-medium">
                    {c.firstName} {c.lastName || ''}
                  </div>
                  <div className="text-xs text-muted-foreground">{c.email}</div>
                </div>
                <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
