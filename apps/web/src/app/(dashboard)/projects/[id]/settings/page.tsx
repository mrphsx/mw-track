'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Check, Copy, Eye, EyeOff, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { ChannelAvatar } from '@/components/channel-avatar';
import { BotSettingsTab } from '@/components/bot-settings-tab';
import { BotScenariosTab } from '@/components/bot-scenarios-tab';
import { TimezoneInput } from '@/components/timezone-input';
import { PersonalAccountConnect } from '@/components/personal-account-connect';
import { LINK_PARAM_FIELDS, LINK_PARAM_NAME_REGEX, resolveParamMap } from '@/lib/link-params';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';

interface Pixel {
  id: string;
  platform: 'FACEBOOK' | 'TIKTOK';
  pixelId: string;
  label: string | null;
  isActive: boolean;
}

interface ChannelSummary {
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

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  timezone: string;
  allowedDomains: string[];
  channel: ChannelSummary | null;
  pixels: Pixel[];
  linkParamMap: Record<string, string> | null;
}

export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => (await api.get<Project>(`/projects/${id}`)).data,
  });

  if (!project) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    // Без ограничения ширины — та же конвенция, что у остальных страниц дашборда
    // (projects/[id]/page.tsx, /landings, /projects), max-w-3xl раньше душил вкладку
    // "Пиксели" (список+параметры трекинг-ссылки в две колонки, запрос пользователя 2026-07-20).
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Настройки проекта</h1>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">Основные</TabsTrigger>
          <TabsTrigger value="channels">Каналы</TabsTrigger>
          {project.channel?.type === 'TELEGRAM' && <TabsTrigger value="bot">Бот</TabsTrigger>}
          {project.channel?.type === 'TELEGRAM' && (
            <TabsTrigger value="personal">Личный аккаунт</TabsTrigger>
          )}
          {project.channel?.type === 'TELEGRAM' && project.channel.tgMode !== 'PERSONAL_DM' && (
            <TabsTrigger value="scenarios">Сценарии</TabsTrigger>
          )}
          <TabsTrigger value="pixels">Пиксели</TabsTrigger>
          <TabsTrigger value="pixel-logs">Логи</TabsTrigger>
          <TabsTrigger value="integration">Интеграция</TabsTrigger>
          <TabsTrigger value="danger">Опасная зона</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <GeneralTab project={project} />
        </TabsContent>
        <TabsContent value="channels" className="mt-4">
          <ChannelsTab projectId={id} channel={project.channel} />
        </TabsContent>
        {project.channel?.type === 'TELEGRAM' && (
          <TabsContent value="bot" className="mt-4">
            <BotSettingsTab
              projectId={id}
              channelId={project.channel.id}
              channelType={project.channel.type}
            />
          </TabsContent>
        )}
        {project.channel?.type === 'TELEGRAM' && (
          <TabsContent value="personal" className="mt-4">
            <PersonalAccountConnect channelId={project.channel.id} />
          </TabsContent>
        )}
        {project.channel?.type === 'TELEGRAM' && project.channel.tgMode !== 'PERSONAL_DM' && (
          <TabsContent value="scenarios" className="mt-4">
            <BotScenariosTab channelId={project.channel.id} />
          </TabsContent>
        )}
        <TabsContent value="pixels" className="mt-4">
          <PixelsTab projectId={id} pixels={project.pixels} linkParamMap={project.linkParamMap} />
        </TabsContent>
        <TabsContent value="pixel-logs" className="mt-4">
          <PixelLogsTab projectId={id} pixels={project.pixels} />
        </TabsContent>
        <TabsContent value="integration" className="mt-4">
          <IntegrationTab projectId={id} allowedDomains={project.allowedDomains} />
        </TabsContent>
        <TabsContent value="danger" className="mt-4">
          <DangerTab projectId={id} onArchived={() => router.push('/projects')} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GeneralTab({ project }: { project: Project }) {
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
function ChannelsTab({ projectId, channel }: { projectId: string; channel: Project['channel'] }) {
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
              {channel.type === 'TELEGRAM' && (
                <ChannelAvatar
                  channelId={channel.id}
                  hasAvatar={!!channel.tgAvatarFileId}
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
                {!channel.isActive && channel.lastError && (
                  <p className="text-xs text-red-500 max-w-md">{channel.lastError}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="w-4 h-4" />
              </Button>
              {!channel.isActive && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reactivateChannel.mutate(channel.id)}
                  disabled={reactivateChannel.isPending}
                >
                  Переподключить
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

function PixelsTab({
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
  const [error, setError] = useState('');

  const resetForm = () => {
    setShowAddForm(false);
    setPlatform('FACEBOOK');
    setLabel('');
    setPixelId('');
    setAccessToken('');
    setTestEventCode('');
  };

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
              <div
                key={pixel.id}
                className="flex items-center justify-between gap-3 py-2 border-b last:border-0"
              >
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
                </div>
                {pixel.isActive && hasPermission(user, 'PIXELS_DELETE') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => deactivatePixel.mutate(pixel.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {!showAddForm && hasPermission(user, 'PIXELS_CREATE') && (
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

const EVENT_NAME_OPTIONS = [
  'PageView',
  'Lead',
  'Subscribe',
  'Dialogue',
  'Purchase',
  'InitiateCheckout',
  'Click',
];
const ALL_VALUE = '__all__';

interface PixelLogEntry {
  id: string;
  status: string;
  error: string | null;
  externalEventId: string | null;
  sentAt: string;
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
function PixelLogsTab({ projectId, pixels }: { projectId: string; pixels: Pixel[] }) {
  const [page, setPage] = useState(1);
  const [pixelFilter, setPixelFilter] = useState(ALL_VALUE);
  const [statusFilter, setStatusFilter] = useState(ALL_VALUE);
  const [eventFilter, setEventFilter] = useState(ALL_VALUE);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
            <SelectValue />
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
            <SelectValue />
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
            <SelectValue />
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
                    <div className="px-4 pb-3 space-y-2 text-xs">
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
                      <div>
                        <p className="text-muted-foreground mb-1">Отправленные данные (payload события):</p>
                        <pre className="bg-muted border rounded p-2 overflow-x-auto">
                          {JSON.stringify(log.event.payload, null, 2)}
                        </pre>
                      </div>
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

function IntegrationTab({
  projectId,
  allowedDomains,
}: {
  projectId: string;
  allowedDomains: string[];
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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ключи доступа</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="public-token">Public Token</Label>
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
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="node">
            <TabsList>
              <TabsTrigger value="node">Node.js (SDK)</TabsTrigger>
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

function DangerTab({ projectId, onArchived }: { projectId: string; onArchived: () => void }) {
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
