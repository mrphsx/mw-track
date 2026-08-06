'use client';

// Studio-версия вкладок настроек проекта (запрос пользователя 2026-07-30: "в настройках проекта
// именно внутренние формы тоже доделай под дизайн studio") — в отличие от первого прохода
// (studio/projects/[id]/settings/page.tsx, который переиспользовал классические компоненты
// вкладок буквально без изменений), здесь сама разметка каждой вкладки переоформлена: карточки
// на STUDIO_CARD, бейджи на StudioPill, основные кнопки на StudioLinkButton, текстовые цвета —
// на палитру Cobalt Field. Input/Label/Textarea/Select/Switch/Dialog оставлены как есть (тот же
// принцип, что и во всех остальных Studio-страницах весь день — эти примитивы уже нейтральны и
// переиспользуются без реskin'а в каждом диалоге Studio, форкать их означало бы форкать весь
// shadcn-кит ради этой одной страницы). Логика (state/мутации/запросы) скопирована 1:1 из
// apps/web/.../(dashboard)/projects/[id]/settings/tabs.tsx — ничего не изменено функционально,
// только JSX/классы.
import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { AlertTriangle, Check, CheckCircle2, Copy, Eye, EyeOff, Pencil, Plus, Trash2, Users, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { ChannelAvatar } from '@/components/channel-avatar';
import { TimezoneInput } from '@/components/timezone-input';
import { LINK_PARAM_FIELDS, LINK_PARAM_NAME_REGEX, resolveParamMap } from '@/lib/link-params';
import { TRACKING_EVENT_TYPES } from '@/lib/tracking-events';
import { BotScenarioListItem } from '@/lib/scenarios';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Pixel, Project } from '../../../../../(dashboard)/projects/[id]/settings/tabs';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../../../ui';

const MUTED = 'text-[#5F6B7A] dark:text-[#92A0AF]';
const FG = 'text-[#131A24] dark:text-[#E9EDF3]';

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
    <div className={`${STUDIO_CARD} p-5 space-y-4`}>
      <div className="space-y-1.5">
        <Label htmlFor="general-name">Название</Label>
        <Input id="general-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="general-description">Описание</Label>
        <Textarea id="general-description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <TimezoneInput id="general-timezone" value={timezone} onChange={setTimezone} />
      <StudioLinkButton variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? 'Сохраняем...' : 'Сохранить'}
      </StudioLinkButton>
    </div>
  );
}

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
      <div className={`${STUDIO_CARD} p-5 text-sm text-red-600 dark:text-red-400`}>
        У проекта нет канала — это не должно происходить в норме, обратитесь в поддержку.
      </div>
    );
  }

  const title = channel.tgChannelTitle || channel.tgBotFirstName;
  const handle = channel.tgChannelUsername || channel.tgBotUsername || channel.tgPersonalUsername;

  return (
    <div className="space-y-4">
      <div className={`${STUDIO_CARD} p-5`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {channel.type === 'TELEGRAM' && (
              <ChannelAvatar channelId={channel.id} hasAvatar={!!channel.tgAvatarFileId} fallbackLetter={title || handle || channel.type} />
            )}
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <StudioPill hue={channel.isActive ? 'slate' : 'plum'}>{CHANNEL_TYPE_LABEL[channel.type as ChannelType] ?? channel.type}</StudioPill>
                {channel.type === 'TELEGRAM' && channel.tgMode && <StudioPill hue="teal">{TG_MODE_LABEL[channel.tgMode]}</StudioPill>}
                <span className={`text-sm ${MUTED}`}>{channel.isActive ? 'Активен' : 'Отключён'}</span>
              </div>
              {(title || handle) && (
                <div className="text-sm">
                  {title && <span className={`font-medium ${FG}`}>{title}</span>}
                  {handle && (
                    <a
                      href={`https://t.me/${handle.replace(/^@/, '')}`}
                      target="_blank"
                      rel="noopener"
                      className={`${MUTED} ml-1.5 hover:underline`}
                    >
                      @{handle.replace(/^@/, '')}
                    </a>
                  )}
                  {channel.tgChannelMembersCount != null && (
                    <span className={`${MUTED} ml-1.5 inline-flex items-center gap-0.5`}>
                      <Users className="w-3 h-3" /> {channel.tgChannelMembersCount}
                    </span>
                  )}
                </div>
              )}
              {!channel.isActive && channel.lastError && <p className="text-xs text-red-600 dark:text-red-400 max-w-md">{channel.lastError}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setEditing(true)} className={`${MUTED} hover:${FG}`}>
              <Pencil className="w-4 h-4" />
            </button>
            {!channel.isActive && (
              <StudioLinkButton size="sm" onClick={() => reactivateChannel.mutate(channel.id)} disabled={reactivateChannel.isPending}>
                Переподключить
              </StudioLinkButton>
            )}
            {channel.isActive && (
              <button type="button" onClick={() => deactivateChannel.mutate(channel.id)} className="text-[#5F6B7A] dark:text-[#92A0AF] hover:text-red-600 dark:hover:text-red-400">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <EditChannelDialog channelId={editing ? channel.id : null} projectId={projectId} onClose={() => setEditing(false)} />
    </div>
  );
}

interface ChannelFull {
  id: string;
  type: string;
  name: string;
  tgMode: TgMode | null;
  tgBotToken: string | null;
  tgChannelId: string | null;
  tgChannelUsername: string | null;
  tgPersonalUsername: string | null;
  wa360Token: string | null;
  igPageId: string | null;
  igAccessToken: string | null;
}

function EditChannelDialog({ channelId, projectId, onClose }: { channelId: string | null; projectId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ChannelFormState | null>(null);
  const [error, setError] = useState('');

  const { data: full, isLoading } = useQuery({
    queryKey: ['channel', channelId],
    queryFn: async () => (await api.get<ChannelFull>(`/channels/${channelId}`)).data,
    enabled: !!channelId,
  });

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
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить канал'),
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
              <StudioLinkButton variant="primary" onClick={() => save.mutate()} disabled={!channelFormCanSubmit(form) || save.isPending}>
                {save.isPending ? 'Сохраняем...' : 'Сохранить'}
              </StudioLinkButton>
              <StudioLinkButton onClick={close}>Отмена</StudioLinkButton>
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

const TEST_EVENT_CODE_PATTERN = /^TEST\d+$/i;
const TESTABLE_EVENT_NAMES = ['PageView', 'Lead', 'Subscribe', 'Unsubscribe', 'Dialogue', 'Purchase', 'InitiateCheckout'];

interface PixelTestEventResult {
  success: boolean;
  error?: string;
  warning?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  testEventCode?: string | null;
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
          // Раньше выбирался в дропдауне (Chat/Website) — запрос пользователя 2026-07-31:
          // "для проверки убери дропдаун с chat website, пусть будет всегда website".
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
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось добавить пиксель'),
  });

  const deactivatePixel = useMutation({
    mutationFn: (pixelId: string) => api.delete(`/pixels/${pixelId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
  });

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
        accessToken: editAccessToken || undefined,
        testEventCode: editTestEventCode || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setEditingPixelId(null);
    },
  });

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
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_440px] gap-4 items-start">
      <div className="order-2 lg:order-1 space-y-4">
        <div className={`${STUDIO_CARD} p-5 space-y-3`}>
          {pixels.length === 0 && <p className={`text-sm ${MUTED}`}>Пиксели не привязаны.</p>}
          {pixels.map((pixel) => (
            <div key={pixel.id} className="py-2 border-b border-[#DCE1E8] dark:border-white/10 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <StudioPill hue={pixel.isActive ? 'slate' : 'plum'}>{PLATFORM_LABEL[pixel.platform]}</StudioPill>
                  <span className={`text-sm truncate ${FG}`} title={pixel.label || pixel.pixelId}>
                    {pixel.label || pixel.pixelId}
                  </span>
                  <span className={`text-sm ${MUTED} shrink-0`}>{pixel.isActive ? 'Активен' : 'Отключён'}</span>
                  {pixel.testEventCode && (
                    <StudioPill hue="teal" danger={false}>
                      <span title={`Test Event Code: ${pixel.testEventCode}`}>Тестовый режим</span>
                    </StudioPill>
                  )}
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  {pixel.isActive && hasPermission(user, projectId, 'PIXELS_EDIT') && (
                    <button
                      type="button"
                      onClick={() => (editingPixelId === pixel.id ? setEditingPixelId(null) : startEditingPixel(pixel))}
                      className={`${MUTED} hover:${FG}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  {pixel.isActive && hasPermission(user, projectId, 'PIXELS_DELETE') && (
                    <button type="button" onClick={() => deactivatePixel.mutate(pixel.id)} className={`${MUTED} hover:text-red-600 dark:hover:text-red-400`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              {/* Автор (запрос пользователя 2026-08-03) */}
              {pixel.createdBy && (
                <p className={`text-xs ${MUTED} mt-0.5`}>
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
                    <Input id={`edit-token-${pixel.id}`} type="password" value={editAccessToken} onChange={(e) => setEditAccessToken(e.target.value)} />
                  </div>
                  {pixel.platform === 'FACEBOOK' && (
                    <div className="space-y-1.5">
                      <Label htmlFor={`edit-tec-${pixel.id}`}>Test Event Code (пусто — убрать, реклама пойдёт в реальную статистику)</Label>
                      <Input id={`edit-tec-${pixel.id}`} value={editTestEventCode} onChange={(e) => setEditTestEventCode(e.target.value)} />
                    </div>
                  )}

                  <div className="space-y-1.5 pt-1 border-t border-[#DCE1E8] dark:border-white/10">
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
                      <StudioLinkButton size="sm" onClick={() => editTestEvent.mutate(pixel.id)} disabled={editTestEvent.isPending}>
                        {editTestEvent.isPending ? 'Отправляем...' : 'Отправить тест'}
                      </StudioLinkButton>
                    </div>
                    {pixel.platform === 'FACEBOOK' && !editTestEventCode && (
                      <p className="text-xs text-[#B23A1E] dark:text-[#F0855E]">Без Test Event Code тестовое событие уйдёт как настоящее и попадёт в статистику пикселя.</p>
                    )}
                    {editTestEvent.data && (
                      <div className="space-y-2 pt-1">
                        <p className={`text-sm ${editTestEvent.data.success ? 'text-[#1F7A6C] dark:text-[#6FCBBA]' : 'text-red-600 dark:text-red-400'}`}>
                          {editTestEvent.data.success
                            ? editTestEvent.data.warning
                              ? `⚠ ${editTestEvent.data.warning}`
                              : 'Событие отправлено и принято платформой.'
                            : `Ошибка: ${editTestEvent.data.error}`}
                        </p>
                        <p className={`text-xs ${MUTED}`}>Test Event Code: {editTestEvent.data.testEventCode || 'не использован (уйдёт как настоящее событие)'}</p>
                        {!!editTestEvent.data.curlCommand && (
                          <div>
                            <p className={`text-xs ${MUTED} mb-1`}>Полный запрос (curl, с реальным access_token — можно вставить прямо в cmd):</p>
                            <CodeBlock code={editTestEvent.data.curlCommand} />
                          </div>
                        )}
                        {!!editTestEvent.data.requestPayload && (
                          <div>
                            <p className={`text-xs ${MUTED} mb-1`}>Тело запроса:</p>
                            <CodeBlock code={JSON.stringify(editTestEvent.data.requestPayload, null, 2)} />
                          </div>
                        )}
                        {!!editTestEvent.data.responsePayload && (
                          <div>
                            <p className={`text-xs ${MUTED} mb-1`}>Ответ платформы:</p>
                            <CodeBlock code={JSON.stringify(editTestEvent.data.responsePayload, null, 2)} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <StudioLinkButton variant="primary" size="sm" onClick={() => updatePixel.mutate(pixel.id)} disabled={updatePixel.isPending}>
                      {updatePixel.isPending ? 'Сохраняем...' : 'Сохранить'}
                    </StudioLinkButton>
                    <StudioLinkButton size="sm" onClick={() => setEditingPixelId(null)}>
                      Отмена
                    </StudioLinkButton>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {!showAddForm && hasPermission(user, projectId, 'PIXELS_CREATE') && (
          <StudioLinkButton icon={Plus} onClick={() => setShowAddForm(true)}>
            Добавить пиксель
          </StudioLinkButton>
        )}

        {showAddForm && (
          <div className={`${STUDIO_CARD} p-5 space-y-3`}>
            <h3 className={`text-base font-semibold ${FG}`}>Новый пиксель</h3>
            <p className={`text-xs ${MUTED}`}>
              Проект не привязан к одной платформе — можно добавить сколько угодно пикселей любых
              платформ одновременно (несколько FB-аккаунтов, FB + TikTok и т.д.). Каждое событие
              уйдёт во все активные пиксели проекта.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="pixel-platform">Платформа</Label>
              <Select value={platform} onValueChange={(v) => v && setPlatform(v as Pixel['platform'])}>
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
              <Input id="pixel-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Например: основной аккаунт" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pixel-id">Pixel ID</Label>
              <Input id="pixel-id" value={pixelId} onChange={(e) => setPixelId(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pixel-access-token">Access Token</Label>
              <Input id="pixel-access-token" type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
            </div>
            {platform === 'FACEBOOK' && (
              <div className="space-y-1.5">
                <Label htmlFor="pixel-test-event-code">Test Event Code (опционально, для отладки CAPI)</Label>
                <Input id="pixel-test-event-code" value={testEventCode} onChange={(e) => setTestEventCode(e.target.value)} />
                <p className={`text-xs ${MUTED}`}>
                  Скопируйте код со страницы Meta Events Manager → вкладка &quot;Тестовые
                  события&quot; (обычно вида TEST1234) — события с этим кодом будут видны там же в
                  реальном времени, не влияя на статистику пикселя.
                </p>
                {testEventCode && !TEST_EVENT_CODE_PATTERN.test(testEventCode) && (
                  <p className="text-xs text-[#B23A1E] dark:text-[#F0855E]">Обычно код Meta выглядит как TEST + цифры (например, TEST1234) — проверьте, что скопировали верно.</p>
                )}
              </div>
            )}
            <div className="space-y-1.5 pt-1 border-t border-[#DCE1E8] dark:border-white/10">
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
                    отправить тест больше чем дропдауны рядом с ней"), из-за чего кнопка была
                    заметно выше соседних <Select>, у которых высота h-8 по умолчанию. */}
                <StudioLinkButton size="sm" onClick={() => testEvent.mutate()} disabled={!pixelId || !accessToken || testEvent.isPending}>
                  {testEvent.isPending ? 'Отправляем...' : 'Отправить тест'}
                </StudioLinkButton>
              </div>
              {platform === 'FACEBOOK' && !testEventCode && (
                <p className="text-xs text-[#B23A1E] dark:text-[#F0855E]">Без Test Event Code тестовое событие уйдёт как настоящее и попадёт в статистику пикселя.</p>
              )}
              {testEvent.data && (
                <div className="space-y-2 pt-1">
                  <p className={`text-sm ${testEvent.data.success ? 'text-[#1F7A6C] dark:text-[#6FCBBA]' : 'text-red-600 dark:text-red-400'}`}>
                    {testEvent.data.success
                      ? testEvent.data.warning
                        ? `⚠ ${testEvent.data.warning}`
                        : 'Событие отправлено и принято платформой.'
                      : `Ошибка: ${testEvent.data.error}`}
                  </p>
                  <p className={`text-xs ${MUTED}`}>Test Event Code: {testEvent.data.testEventCode || 'не использован (уйдёт как настоящее событие)'}</p>
                  {!!testEvent.data.curlCommand && (
                    <div>
                      <p className={`text-xs ${MUTED} mb-1`}>Полный запрос (curl, с реальным access_token — можно вставить прямо в cmd):</p>
                      <CodeBlock code={testEvent.data.curlCommand} />
                    </div>
                  )}
                  {!!testEvent.data.requestPayload && (
                    <div>
                      <p className={`text-xs ${MUTED} mb-1`}>Тело запроса:</p>
                      <CodeBlock code={JSON.stringify(testEvent.data.requestPayload, null, 2)} />
                    </div>
                  )}
                  {!!testEvent.data.responsePayload && (
                    <div>
                      <p className={`text-xs ${MUTED} mb-1`}>Ответ платформы:</p>
                      <CodeBlock code={JSON.stringify(testEvent.data.responsePayload, null, 2)} />
                    </div>
                  )}
                </div>
              )}
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <StudioLinkButton variant="primary" onClick={() => addPixel.mutate()} disabled={!pixelId || !accessToken || addPixel.isPending}>
                {addPixel.isPending ? 'Добавляем...' : 'Добавить'}
              </StudioLinkButton>
              <StudioLinkButton onClick={resetForm}>Отмена</StudioLinkButton>
            </div>
          </div>
        )}
      </div>

      <div className="order-1 lg:order-2">
        <LinkParamsCard projectId={projectId} linkParamMap={linkParamMap} />
      </div>
    </div>
  );
}

function LinkParamsCard({ projectId, linkParamMap }: { projectId: string; linkParamMap: Record<string, string> | null }) {
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
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить'),
  });

  const invalid = Object.values(values).some((v) => !LINK_PARAM_NAME_REGEX.test(v));

  return (
    <div className={`${STUDIO_CARD} p-5 space-y-3`}>
      <h3 className={`text-base font-semibold ${FG}`}>Параметры трекинг-ссылки</h3>
      <p className={`text-xs ${MUTED}`}>
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
      {invalid && <p className="text-sm text-red-500">Разрешены только буквы, цифры и подчёркивание.</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
      <StudioLinkButton variant="primary" onClick={() => save.mutate()} disabled={invalid || save.isPending}>
        {save.isPending ? 'Сохраняем...' : 'Сохранить'}
      </StudioLinkButton>
    </div>
  );
}

const EVENT_NAME_OPTIONS = ['Subscribe', 'Unsubscribe', 'Dialogue', 'Purchase', 'InitiateCheckout', 'Click'];
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

  // Цвета фильтров этой вкладки (запрос пользователя 2026-07-31: "не под наш основной дизайн,
  // цвета другие") — базовый <SelectTrigger> использует нейтральные shadcn-токены
  // (border-input/bg-transparent), не завязанные на палитру Cobalt Field, которой раскрашен
  // весь остальной Studio — здесь этот класс переопределён явно, тем же набором цветов, что и у
  // STUDIO_CARD/остальных элементов страницы.
  const studioSelectTrigger = 'border-[#DCE1E8] dark:border-white/10 bg-white dark:bg-[#171F2B] text-[#131A24] dark:text-[#E9EDF3] rounded-lg';

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
          <SelectTrigger className={`w-48 ${studioSelectTrigger}`}>
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
          <SelectTrigger className={`w-40 ${studioSelectTrigger}`}>
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
          <SelectTrigger className={`w-40 ${studioSelectTrigger}`}>
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

      <div className={STUDIO_CARD}>
        {!data?.items.length ? (
          <p className={`p-5 text-sm ${MUTED}`}>Логов пока нет.</p>
        ) : (
          <div className="divide-y divide-[#DCE1E8] dark:divide-white/10">
            {data.items.map((log) => (
              <div key={log.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId((cur) => (cur === log.id ? null : log.id))}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-left hover:bg-[#F3F5F8] dark:hover:bg-white/5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <StudioPill hue={log.status === 'sent' ? 'sage' : 'plum'}>{log.status === 'sent' ? 'Отправлено' : 'Ошибка'}</StudioPill>
                    <span className={`font-medium ${FG}`}>{log.event.eventName}</span>
                    <span className={`${MUTED} truncate`}>
                      {log.pixel.label || log.pixel.pixelId} ({PLATFORM_LABEL[log.pixel.platform as Pixel['platform']]})
                    </span>
                  </div>
                  <span className={`${MUTED} shrink-0`}>{new Date(log.sentAt).toLocaleString('ru-RU')}</span>
                </button>
                {expandedId === log.id && (
                  <div className="px-4 pb-4 space-y-3 text-xs">
                    <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 ${MUTED}`}>
                      <span className={`font-semibold ${FG}`}>{PLATFORM_LABEL[log.pixel.platform as Pixel['platform']]}</span>
                      <span>ID: {log.pixel.pixelId}</span>
                      <span>{new Date(log.sentAt).toLocaleString('ru-RU')}</span>
                    </div>
                    {log.error && <p className="text-red-600 dark:text-red-400">Ошибка: {log.error}</p>}
                    {log.externalEventId && <p className={MUTED}>ID на стороне платформы: {log.externalEventId}</p>}
                    {(log.event.campaignId || log.event.adId) && (
                      <p className={MUTED}>
                        Кампания: {log.event.campaignName || log.event.campaignId || '—'}
                        {log.event.adId ? ` / Объявление: ${log.event.adName || log.event.adId}` : ''}
                      </p>
                    )}
                    {log.requestPayload || log.responsePayload ? (
                      <>
                        <div>
                          <p className={`${MUTED} mb-1`}>Payload (отправленные данные)</p>
                          <CodeBlock code={JSON.stringify(log.requestPayload ?? '—', null, 4)} />
                        </div>
                        <div>
                          <p className={`${MUTED} mb-1`}>Response (ответ сервера)</p>
                          <CodeBlock code={JSON.stringify(log.responsePayload ?? '—', null, 4)} />
                        </div>
                        <p className={MUTED}>HTTP Status: {log.httpStatus ?? '—'}</p>
                        {log.curlCommand && (
                          <div>
                            <p className={`${MUTED} mb-1`}>Полный запрос (curl, с реальным access_token — только для Owner)</p>
                            <CodeBlock code={log.curlCommand} />
                          </div>
                        )}
                      </>
                    ) : (
                      <div>
                        <p className={`${MUTED} mb-1`}>Отправленные данные (payload события) — запись до включения полного лога запроса/ответа:</p>
                        <CodeBlock code={JSON.stringify(log.event.payload, null, 4)} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <StudioLinkButton size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Назад
          </StudioLinkButton>
          <span className={`text-sm ${MUTED}`}>
            {data.page} / {data.totalPages}
          </span>
          <StudioLinkButton size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Далее
          </StudioLinkButton>
        </div>
      )}
    </div>
  );
}

export function EventsTab({ projectId, disabledTrackingEvents }: { projectId: string; disabledTrackingEvents: string[] }) {
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: (next: string[]) => api.patch(`/projects/${projectId}`, { disabledTrackingEvents: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  return (
    <div className={`${STUDIO_CARD} p-5`}>
      <h3 className={`text-base font-semibold ${FG} mb-1`}>Отправка событий в рекламные платформы</h3>
      <p className={`text-sm ${MUTED} mb-3`}>Выключенные события по-прежнему видны в CRM и в логах, но не отправляются в Facebook/TikTok.</p>
      {TRACKING_EVENT_TYPES.map((eventType) => {
        const isEnabled = !disabledTrackingEvents.includes(eventType.name);
        return (
          <div key={eventType.name} className="flex items-start justify-between gap-4 py-2.5 border-b border-[#DCE1E8] dark:border-white/10 last:border-b-0">
            <div className="min-w-0">
              <p className={`text-sm font-medium ${FG}`}>{eventType.label}</p>
              <p className={`text-xs ${MUTED}`}>{eventType.description}</p>
            </div>
            <Switch
              checked={isEnabled}
              disabled={toggle.isPending}
              onCheckedChange={(checked) => {
                const next = checked ? disabledTrackingEvents.filter((n) => n !== eventType.name) : [...disabledTrackingEvents, eventType.name];
                toggle.mutate(next);
              }}
              className="shrink-0 mt-0.5"
            />
          </div>
        );
      })}
    </div>
  );
}

export function IntegrationTab({ projectId, allowedDomains }: { projectId: string; allowedDomains: string[] }) {
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
    queryFn: async () => (await api.get<Project & { secretKey: string }>(`/projects/${projectId}`)).data,
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
        allowedDomains: domainsText.split('\n').map((d) => d.trim()).filter(Boolean),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  return (
    <div className="space-y-4">
      <div className={`${STUDIO_CARD} p-5 space-y-3`}>
        <h3 className={`text-base font-semibold ${FG}`}>Ключи доступа</h3>
        <div className="space-y-1.5">
          <Label htmlFor="public-token">Public Token</Label>
          <div className="flex gap-2">
            <Input id="public-token" readOnly value={snippet?.publicToken || ''} />
            <button
              type="button"
              onClick={() => copyToClipboard(snippet?.publicToken || '')}
              className="shrink-0 px-3 rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="secret-key">Secret Key</Label>
          <div className="flex gap-2">
            <Input id="secret-key" readOnly type={showSecret ? 'text' : 'password'} value={project?.secretKey || ''} />
            <button
              type="button"
              onClick={() => setShowSecret((s) => !s)}
              className="shrink-0 px-3 rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]"
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => copyToClipboard(project?.secretKey || '')}
              className="shrink-0 px-3 rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm('Старые ключи перестанут работать немедленно. Продолжить?')) regenerate.mutate();
          }}
          className="text-sm px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 font-medium"
        >
          Перегенерировать ключи
        </button>
      </div>

      <div className={`${STUDIO_CARD} p-5 space-y-3`}>
        <h3 className={`text-base font-semibold ${FG}`}>Разрешённые домены (CORS)</h3>
        <Textarea value={domainsText} onChange={(e) => setDomainsText(e.target.value)} placeholder="example.com&#10;shop.example.com" rows={4} />
        <StudioLinkButton variant="primary" size="sm" onClick={() => saveDomains.mutate()} disabled={saveDomains.isPending}>
          Сохранить
        </StudioLinkButton>
      </div>

      <div className={`${STUDIO_CARD} p-5 space-y-3`}>
        <h3 className={`text-base font-semibold ${FG}`}>JS-сниппет (вставить в &lt;head&gt; лендинга)</h3>
        <CodeBlock code={snippet?.snippet || ''} />
      </div>

      <div className={`${STUDIO_CARD} p-5 space-y-3`}>
        <h3 className={`text-base font-semibold ${FG}`}>Серверная интеграция</h3>
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
      </div>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="relative">
      <pre className="text-xs bg-[#0F1620] text-[#E9EDF3] rounded-lg p-3 pr-10 overflow-x-auto">{code}</pre>
      <button
        type="button"
        className="absolute top-2 right-2 h-7 w-7 flex items-center justify-center rounded-md text-[#92A0AF] hover:text-white hover:bg-white/10"
        onClick={async () => {
          await copyToClipboard(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}

export function DangerTab({ projectId, onArchived }: { projectId: string; onArchived: () => void }) {
  const archive = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}`),
    onSuccess: onArchived,
  });

  return (
    <div className={`${STUDIO_CARD} p-5 flex items-center justify-between flex-wrap gap-3 ring-2 ring-red-200 dark:ring-red-900/60`}>
      <div>
        <div className={`font-medium ${FG}`}>Архивировать проект</div>
        <div className={`text-sm ${MUTED}`}>Проект и все данные останутся в системе, но станут недоступны.</div>
      </div>
      <button
        type="button"
        onClick={() => {
          if (confirm('Архивировать проект?')) archive.mutate();
        }}
        className="text-sm px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 font-medium"
      >
        Архивировать
      </button>
    </div>
  );
}

interface ProjectOperator {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  isActive: boolean;
}

// Studio-версия управления операторами проекта — логика 1:1 с классической (см. её комментарий
// в apps/web/.../(dashboard)/projects/[id]/settings/tabs.tsx), только STUDIO_CARD/StudioPill/
// StudioLinkButton вместо Card/Badge/Button.
export function OperatorsTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [search, setSearch] = useState('');

  const { data: operators, isLoading } = useQuery({
    queryKey: ['project-operators', projectId],
    queryFn: async () => (await api.get<ProjectOperator[]>(`/projects/${projectId}/operators`)).data,
  });

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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className={`text-sm ${MUTED}`}>
          Операторы с доступом к клиентам этого проекта. Права фиксированные — как только
          оператор добавлен, он сразу видит клиентов и может регистрировать депозиты.
        </p>
        <StudioLinkButton variant="primary" icon={Plus} onClick={() => setShowAddDialog(true)}>
          Добавить оператора
        </StudioLinkButton>
      </div>

      {isLoading && <p className={`text-sm ${MUTED}`}>Загрузка...</p>}
      {!isLoading && !operators?.length && <p className={`text-sm ${MUTED}`}>Операторов пока нет.</p>}
      {!!operators?.length && (
        <div className={`${STUDIO_CARD} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={`text-left text-xs ${MUTED} border-b border-[#DCE1E8] dark:border-white/10`}>
                <th className="px-5 py-3 font-medium">Оператор</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
              {operators.map((op) => (
                <tr key={op.id}>
                  <td className="px-5 py-3">
                    <div className={`font-medium ${FG}`}>
                      {op.firstName} {op.lastName || ''}
                    </div>
                    <div className={`text-xs ${MUTED}`}>{op.email}</div>
                  </td>
                  <td className="px-5 py-3">
                    {op.isActive ? <StudioPill hue="sage">Активен</StudioPill> : <StudioPill hue="slate">Отключён</StudioPill>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (confirm(`Убрать оператора ${op.email} с этого проекта?`)) remove.mutate(op.id);
                      }}
                      className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm ${MUTED} hover:text-red-600 dark:hover:text-red-400`}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Убрать
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить оператора</DialogTitle>
          </DialogHeader>
          <Input placeholder="Имя или email..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-72 overflow-y-auto space-y-1">
            {!filteredCandidates?.length && <p className={`text-sm ${MUTED} py-2`}>Нет доступных операторов.</p>}
            {filteredCandidates?.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={add.isPending}
                onClick={() => add.mutate(c.id)}
                className="w-full flex items-center justify-between gap-2 rounded-lg border border-[#DCE1E8] dark:border-white/10 p-2.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
              >
                <div>
                  <div className={`font-medium ${FG}`}>
                    {c.firstName} {c.lastName || ''}
                  </div>
                  <div className={`text-xs ${MUTED}`}>{c.email}</div>
                </div>
                <Plus className={`w-4 h-4 ${MUTED} shrink-0`} />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Studio-версии BotSettingsTab/PersonalAccountConnect (запрос пользователя 2026-07-30:
// "теперь сделай под новый дизайн и страницу проектов и настройки" — закрывает известный,
// явно задокументированный пробел с предыдущего прохода: эти 2 компонента раньше оставались
// классическими внутри Studio-настроек). Логика скопирована 1:1 из
// @/components/bot-settings-tab.tsx и @/components/personal-account-connect.tsx — только
// разметка на STUDIO_CARD/StudioPill/StudioLinkButton, Input/Label/Textarea/Checkbox остались
// как есть (тот же принцип, что и у остальных вкладок в этом файле).

interface ChannelBotSettings {
  id: string;
  tgBotToken: string | null;
  tgMode: TgMode | null;
  tgJoinDelaySeconds: number | null;
  tgManagerUsernames: string[] | null;
}

export function BotSettingsTab({ projectId, channelId, channelType }: { projectId: string; channelId: string; channelType: string }) {
  const { data: full } = useQuery({
    queryKey: ['channel', channelId, 'bot-settings'],
    queryFn: async () => (await api.get<ChannelBotSettings>(`/channels/${channelId}`)).data,
  });

  if (channelType !== 'TELEGRAM') {
    return <div className={`${STUDIO_CARD} p-5 text-sm ${MUTED}`}>Настройки бота доступны только для Telegram-канала.</div>;
  }

  if (!full) return <p className={`text-sm ${MUTED}`}>Загрузка...</p>;

  return (
    <div className="space-y-4">
      <div className={`${STUDIO_CARD} p-5 space-y-3`}>
        <h2 className={`text-sm font-semibold ${FG}`}>Токен бота</h2>
        <BotTokenField token={full.tgBotToken} />
      </div>

      {full.tgMode !== 'PRIVATE_CHANNEL_REQUEST' ? (
        <div className={`${STUDIO_CARD} p-5 text-sm ${MUTED}`}>
          Приветственное сообщение отправляется только в режиме «Приватный канал (заявка)» — это единственный
          режим, в котором Telegram сообщает боту момент одобрения заявки. Для личных сообщений и публичного
          канала бот не участвует в подключении пользователя, и отправить приветствие некому.
        </div>
      ) : (
        <>
          <JoinDelayCard channelId={channelId} projectId={projectId} full={full} />
          <SubscribeScenarioCard channelId={channelId} projectId={projectId} />
        </>
      )}

      {full.tgMode !== 'PERSONAL_DM' && <ManagersCard channelId={channelId} projectId={projectId} full={full} />}
    </div>
  );
}

function ManagersCard({ channelId, projectId, full }: { channelId: string; projectId: string; full: ChannelBotSettings }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState((full.tgManagerUsernames || []).join('\n'));
  const [error, setError] = useState('');

  useEffect(() => {
    setText((full.tgManagerUsernames || []).join('\n'));
  }, [full.tgManagerUsernames]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/channels/${channelId}`, {
        tgManagerUsernames: text
          .split('\n')
          .map((u) => u.trim().replace(/^@/, ''))
          .filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'bot-settings'] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить список'),
  });

  return (
    <div className={`${STUDIO_CARD} p-5 space-y-3`}>
      <h2 className={`text-sm font-semibold ${FG}`}>Менеджеры</h2>
      <p className={`text-sm ${MUTED}`}>
        По одному Telegram-username на строку, без @. Эти люди смогут переслать боту сообщение клиента и
        подтвердить запись диалога — без подключения личного аккаунта. Сами менеджеры клиентами не считаются:
        пуши, воронки и сценарии этого бота им не приходят.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'ivan_manager\nmaria_support'}
        rows={4}
        className="font-mono text-sm"
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <StudioLinkButton size="sm" variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? 'Сохраняем...' : 'Сохранить'}
      </StudioLinkButton>
    </div>
  );
}

function JoinDelayCard({ channelId, projectId, full }: { channelId: string; projectId: string; full: ChannelBotSettings }) {
  const queryClient = useQueryClient();
  const [seconds, setSeconds] = useState(String(full.tgJoinDelaySeconds ?? 0));
  const [error, setError] = useState('');

  useEffect(() => {
    setSeconds(String(full.tgJoinDelaySeconds ?? 0));
  }, [full.tgJoinDelaySeconds]);

  const save = useMutation({
    mutationFn: () => api.patch(`/channels/${channelId}`, { tgJoinDelaySeconds: Number(seconds) || 0 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'bot-settings'] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить задержку'),
  });

  return (
    <div className={`${STUDIO_CARD} p-5 space-y-3`}>
      <h2 className={`text-sm font-semibold ${FG}`}>Задержка одобрения заявки</h2>
      <p className={`text-sm ${MUTED}`}>
        Заявка одобряется не сразу, а через указанное число секунд. Подписчик и событие для рекламных
        площадок фиксируются в момент заявки, задержку получает только сам вход в канал.
      </p>
      <div className="flex items-center gap-2">
        <Input type="number" min={0} max={3600} value={seconds} onChange={(e) => setSeconds(e.target.value)} className="max-w-32" />
        <span className={`text-sm ${MUTED}`}>секунд (0 — без задержки, максимум 3600)</span>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <StudioLinkButton size="sm" variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? 'Сохраняем...' : 'Сохранить'}
      </StudioLinkButton>
    </div>
  );
}

function BotTokenField({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!token) return;
    await copyToClipboard(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex gap-1.5">
      <Input readOnly value={token || 'Токен не задан'} className="font-mono text-sm" />
      <button
        type="button"
        onClick={handleCopy}
        disabled={!token}
        className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg transition-colors disabled:opacity-60 ${
          copied
            ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
            : 'bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF]'
        }`}
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function SubscribeScenarioCard({ channelId, projectId }: { channelId: string; projectId: string }) {
  const { data: scenarios } = useQuery({
    queryKey: ['channel', channelId, 'scenarios'],
    queryFn: async () => (await api.get<BotScenarioListItem[]>(`/channels/${channelId}/scenarios`)).data,
  });

  const subscribeScenario = scenarios?.find((s) => s.triggerType === 'SUBSCRIBE');
  const configured = !!subscribeScenario && subscribeScenario.isActive && subscribeScenario.stepCount > 0;
  const href = subscribeScenario
    ? `/projects/${projectId}/scenarios/${subscribeScenario.id}`
    : `/projects/${projectId}/scenarios`;

  return (
    <div className={`${STUDIO_CARD} p-5 space-y-3`}>
      <h2 className={`text-sm font-semibold ${FG}`}>Приветственное сообщение</h2>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          {configured ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-[#1F7A6C] dark:text-[#6FCBBA] shrink-0" />
              <span className={FG}>Настроено — отправится при одобрении заявки на вступление</span>
            </>
          ) : (
            <>
              <XCircle className={`w-4 h-4 ${MUTED} shrink-0`} />
              <span className={MUTED}>Не настроено — новые подписчики ничего не получат</span>
            </>
          )}
        </div>
        <StudioLinkButton size="sm" href={href}>
          Настроить в сценариях
        </StudioLinkButton>
      </div>
    </div>
  );
}

interface ChannelPersonalInfo {
  tgPersonalConnected: boolean;
  tgPersonalPhone: string | null;
}

type PersonalConnectStep = 'risk' | 'phone' | 'code' | 'password';

export function PersonalAccountConnect({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<PersonalConnectStep>('risk');
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const { data: info } = useQuery({
    queryKey: ['channel', channelId, 'personal'],
    queryFn: async () => (await api.get<ChannelPersonalInfo>(`/channels/${channelId}`)).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'personal'] });

  const startConnect = useMutation({
    mutationFn: () => api.post(`/channels/${channelId}/personal-connect/start`, { phone }),
    onSuccess: () => {
      setStep('code');
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось отправить код'),
  });

  const submitCode = useMutation({
    mutationFn: () => api.post<{ needsPassword: boolean; connected: boolean }>(`/channels/${channelId}/personal-connect/code`, { code }),
    onSuccess: ({ data }) => {
      setError('');
      if (data.needsPassword) {
        setStep('password');
        return;
      }
      resetWizard();
      invalidate();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Неверный код'),
  });

  const submitPassword = useMutation({
    mutationFn: () => api.post(`/channels/${channelId}/personal-connect/password`, { password }),
    onSuccess: () => {
      resetWizard();
      invalidate();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Неверный пароль'),
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete(`/channels/${channelId}/personal-connect`),
    onSuccess: () => invalidate(),
  });

  const resetWizard = () => {
    setStep('risk');
    setRiskAccepted(false);
    setPhone('');
    setCode('');
    setPassword('');
  };

  if (!info) return null;

  return (
    <div className={`${STUDIO_CARD} p-5 space-y-4`}>
      <h2 className={`text-sm font-semibold ${FG}`}>Личный аккаунт (диалоги)</h2>
      {info.tgPersonalConnected ? (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <StudioPill hue="sage">Подключён</StudioPill>
            {info.tgPersonalPhone && <span className={`text-sm ${MUTED}`}>{info.tgPersonalPhone}</span>}
          </div>
          <StudioLinkButton
            size="sm"
            disabled={disconnect.isPending}
            onClick={() => {
              if (confirm('Отключить личный аккаунт? Диалоги перестанут учитываться.')) disconnect.mutate();
            }}
          >
            Отключить
          </StudioLinkButton>
        </div>
      ) : (
        <>
          <p className={`text-sm ${MUTED}`}>
            Чтобы CRM видела диалоги с клиентами в личных сообщениях, нужно подключить сам
            аккаунт (не бота) — вход по номеру телефона, как в обычном Telegram-клиенте.
          </p>

          {step === 'risk' && (
            <div className="space-y-3 rounded-lg p-3 bg-amber-50 dark:bg-amber-950/20">
              <div className="flex gap-2 text-sm text-amber-800 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>
                  Telegram не гарантирует сохранность аккаунтов, подключённых через сторонние
                  приложения (не через официальный клиент) — возможны ограничения со стороны
                  Telegram. Мы читаем только входящие сообщения, ничего не отправляем и не
                  меняем от имени аккаунта. Ответственность за возможные последствия для
                  аккаунта — на вас.
                </p>
              </div>
              <label className={`flex items-center gap-2 text-sm ${FG}`}>
                <Checkbox checked={riskAccepted} onCheckedChange={setRiskAccepted} />
                Понимаю и принимаю риск
              </label>
              <StudioLinkButton size="sm" variant="primary" disabled={!riskAccepted} onClick={() => setStep('phone')}>
                Продолжить
              </StudioLinkButton>
            </div>
          )}

          {step === 'phone' && (
            <div className="space-y-2">
              <Label htmlFor="pa-phone">Номер телефона</Label>
              <Input id="pa-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+79991234567" />
              {error && <p className="text-sm text-red-500">{error}</p>}
              <StudioLinkButton size="sm" variant="primary" disabled={!phone || startConnect.isPending} onClick={() => startConnect.mutate()}>
                {startConnect.isPending ? 'Отправляем код...' : 'Получить код'}
              </StudioLinkButton>
            </div>
          )}

          {step === 'code' && (
            <div className="space-y-2">
              <Label htmlFor="pa-code">Код из Telegram</Label>
              <Input id="pa-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="12345" />
              {error && <p className="text-sm text-red-500">{error}</p>}
              <StudioLinkButton size="sm" variant="primary" disabled={!code || submitCode.isPending} onClick={() => submitCode.mutate()}>
                {submitCode.isPending ? 'Проверяем...' : 'Подтвердить'}
              </StudioLinkButton>
            </div>
          )}

          {step === 'password' && (
            <div className="space-y-2">
              <Label htmlFor="pa-password">Пароль двухфакторной аутентификации</Label>
              <Input id="pa-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              {error && <p className="text-sm text-red-500">{error}</p>}
              <StudioLinkButton size="sm" variant="primary" disabled={!password || submitPassword.isPending} onClick={() => submitPassword.mutate()}>
                {submitPassword.isPending ? 'Проверяем...' : 'Подтвердить'}
              </StudioLinkButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}
