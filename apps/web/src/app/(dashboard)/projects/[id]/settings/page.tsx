'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Check, Copy, Eye, EyeOff, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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
  allowedDomains: string[];
  channels: ChannelSummary[];
  pixels: Pixel[];
}

export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => (await api.get<Project>(`/projects/${id}`)).data,
  });

  if (!project) return <p className="text-sm text-gray-500">Загрузка...</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Настройки проекта</h1>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">Основные</TabsTrigger>
          <TabsTrigger value="channels">Каналы</TabsTrigger>
          <TabsTrigger value="pixels">Пиксели</TabsTrigger>
          <TabsTrigger value="integration">Интеграция</TabsTrigger>
          <TabsTrigger value="danger">Опасная зона</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <GeneralTab project={project} />
        </TabsContent>
        <TabsContent value="channels" className="mt-4">
          <ChannelsTab projectId={id} channels={project.channels} />
        </TabsContent>
        <TabsContent value="pixels" className="mt-4">
          <PixelsTab projectId={id} pixels={project.pixels} />
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

  const save = useMutation({
    mutationFn: () => api.patch(`/projects/${id}`, { name, description: description || undefined }),
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
          <Textarea id="general-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Сохраняем...' : 'Сохранить'}
        </Button>
      </CardContent>
    </Card>
  );
}

type ChannelType = 'TELEGRAM' | 'WHATSAPP' | 'INSTAGRAM';

const CHANNEL_TYPE_LABEL: Record<ChannelType, string> = {
  TELEGRAM: 'Telegram',
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
};

// 4 способа, которыми лендинг ведёт в Telegram — см. prisma/schema.prisma enum TelegramMode
// и LandingRendererService.buildTelegramLink. Выбор влияет на то, какие поля канала нужны
// и куда в итоге ведёт кнопка "Вступить" на лендинге.
type TgMode = 'BOT_DIRECT' | 'PRIVATE_CHANNEL_REQUEST' | 'PUBLIC_CHANNEL_DIRECT' | 'PERSONAL_DM';

const TG_MODE_LABEL: Record<TgMode, string> = {
  BOT_DIRECT: 'Сразу в бота',
  PRIVATE_CHANNEL_REQUEST: 'Приватный канал (заявка)',
  PUBLIC_CHANNEL_DIRECT: 'Публичный канал (напрямую)',
  PERSONAL_DM: 'Личные сообщения (без бота)',
};

const TG_MODE_HINT: Record<TgMode, string> = {
  BOT_DIRECT: 'Кнопка открывает чат с ботом — бот фиксирует атрибуцию (fbclid/UTM) и общается с пользователем напрямую.',
  PRIVATE_CHANNEL_REQUEST:
    'Кнопка открывает бота (атрибуция сохраняется), бот присылает ссылку для заявки на вступление в приватный канал и сам её одобряет.',
  PUBLIC_CHANNEL_DIRECT:
    'Кнопка ведёт прямо в публичный канал, без чата с ботом — один клик для пользователя, но атрибуция по клику слабее (нет fbclid/UTM на момент вступления).',
  PERSONAL_DM:
    'Кнопка открывает личный диалог с указанным аккаунтом — без бота и вебхука. Подписчики не попадают в CRM (только клик фиксируется как Lead), пуши через этот канал недоступны.',
};

interface ChannelFormState {
  type: ChannelType;
  name: string;
  tgMode: TgMode;
  botToken: string;
  channelId: string;
  channelUsername: string;
  personalUsername: string;
  wa360Token: string;
  igPageId: string;
  igAccessToken: string;
}

const EMPTY_CHANNEL_FORM: ChannelFormState = {
  type: 'TELEGRAM',
  name: '',
  tgMode: 'BOT_DIRECT',
  botToken: '',
  channelId: '',
  channelUsername: '',
  personalUsername: '',
  wa360Token: '',
  igPageId: '',
  igAccessToken: '',
};

// type не входит сюда намеренно: UpdateChannelDto (PATCH) явно его исключает (тип канала не
// меняется после создания), а ValidationPipe настроен с forbidNonWhitelisted:true — лишнее
// поле в теле PATCH-запроса валит ВЕСЬ запрос 400-кой, независимо от режима/остальных полей.
// addChannel (POST, CreateChannelDto его принимает) добавляет type сам, отдельно.
function channelFormToPayload(f: ChannelFormState) {
  return {
    name: f.name,
    tgMode: f.type === 'TELEGRAM' ? f.tgMode : undefined,
    tgBotToken: f.type === 'TELEGRAM' && f.tgMode !== 'PERSONAL_DM' ? f.botToken : undefined,
    tgChannelId: f.type === 'TELEGRAM' && f.tgMode !== 'PERSONAL_DM' ? f.channelId || undefined : undefined,
    tgChannelUsername: f.type === 'TELEGRAM' && f.tgMode !== 'PERSONAL_DM' ? f.channelUsername || undefined : undefined,
    tgPersonalUsername: f.type === 'TELEGRAM' && f.tgMode === 'PERSONAL_DM' ? f.personalUsername : undefined,
    wa360Token: f.type === 'WHATSAPP' ? f.wa360Token : undefined,
    igPageId: f.type === 'INSTAGRAM' ? f.igPageId : undefined,
    igAccessToken: f.type === 'INSTAGRAM' ? f.igAccessToken : undefined,
  };
}

function channelFormCanSubmit(f: ChannelFormState): boolean {
  return Boolean(
    f.name &&
      (f.type === 'TELEGRAM'
        ? f.tgMode === 'PERSONAL_DM'
          ? f.personalUsername
          : f.botToken && (f.tgMode === 'BOT_DIRECT' || f.channelId) && (f.tgMode !== 'PUBLIC_CHANNEL_DIRECT' || f.channelUsername)
        : f.type === 'WHATSAPP'
          ? f.wa360Token
          : f.igPageId && f.igAccessToken),
  );
}

// Поле-секрет с возможностью раскрыть/скопировать — для редактирования уже существующего
// канала (где значение реально хранится и есть что показать), в отличие от формы создания,
// где пользователь только печатает новое значение и раскрывать пока нечего.
function SecretField({
  id,
  label,
  value,
  onChange,
  revealable,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  revealable: boolean;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await copyToClipboard(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-1.5">
        <Input id={id} type={visible ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        {revealable && (
          <>
            <Button type="button" size="icon" variant="outline" onClick={() => setVisible((v) => !v)}>
              {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </Button>
            <Button type="button" size="icon" variant={copied ? 'default' : 'outline'} onClick={handleCopy}>
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// Общие поля формы канала — используются и при создании, и при редактировании. `lockType`
// запрещает менять тип после создания (backend это и так не примет — UpdateChannelDto не
// включает type), `secretsRevealable` включает Eye/Copy у токенов (есть смысл только когда
// значение реально загружено с сервера, а не печатается с нуля).
function ChannelFieldsEditor({
  value,
  onChange,
  lockType,
  secretsRevealable,
}: {
  value: ChannelFormState;
  onChange: (next: ChannelFormState) => void;
  lockType?: boolean;
  secretsRevealable?: boolean;
}) {
  const set = <K extends keyof ChannelFormState>(key: K, v: ChannelFormState[K]) => onChange({ ...value, [key]: v });

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="channel-type">Тип канала</Label>
        {lockType ? (
          <p className="text-sm">{CHANNEL_TYPE_LABEL[value.type]}</p>
        ) : (
          <Select value={value.type} onValueChange={(v) => v && set('type', v as ChannelType)}>
            <SelectTrigger id="channel-type">
              <SelectValue>{(v: ChannelType) => CHANNEL_TYPE_LABEL[v]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TELEGRAM">Telegram</SelectItem>
              <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
              <SelectItem value="INSTAGRAM">Instagram</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="channel-name">Название (внутреннее)</Label>
        <Input id="channel-name" value={value.name} onChange={(e) => set('name', e.target.value)} />
      </div>

      {value.type === 'TELEGRAM' && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="channel-tg-mode">Способ вступления</Label>
            <Select value={value.tgMode} onValueChange={(v) => v && set('tgMode', v as TgMode)}>
              <SelectTrigger id="channel-tg-mode">
                <SelectValue>{(v: TgMode) => TG_MODE_LABEL[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TG_MODE_LABEL) as TgMode[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {TG_MODE_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">{TG_MODE_HINT[value.tgMode]}</p>
          </div>

          {value.tgMode === 'PERSONAL_DM' ? (
            <div className="space-y-1.5">
              <Label htmlFor="channel-personal-username">Username личного аккаунта</Label>
              <Input
                id="channel-personal-username"
                value={value.personalUsername}
                onChange={(e) => set('personalUsername', e.target.value)}
                placeholder="@myusername"
              />
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500">
                Создайте бота через @BotFather
                {value.tgMode !== 'BOT_DIRECT' && ', добавьте его администратором в ваш канал'}, вставьте токен ниже.
              </p>
              <SecretField
                id="channel-bot-token"
                label="Bot Token"
                value={value.botToken}
                onChange={(v) => set('botToken', v)}
                revealable={!!secretsRevealable}
                placeholder="123456:ABC-..."
              />
              <div className="space-y-1.5">
                <Label htmlFor="channel-id">
                  Channel ID (числовой){value.tgMode === 'BOT_DIRECT' ? ', опционально' : ''}
                </Label>
                <Input id="channel-id" value={value.channelId} onChange={(e) => set('channelId', e.target.value)} placeholder="-1001234567890" />
              </div>
              {value.tgMode === 'PUBLIC_CHANNEL_DIRECT' && (
                <div className="space-y-1.5">
                  <Label htmlFor="channel-username">Публичный username канала</Label>
                  <Input
                    id="channel-username"
                    value={value.channelUsername}
                    onChange={(e) => set('channelUsername', e.target.value)}
                    placeholder="@mychannel"
                  />
                </div>
              )}
            </>
          )}
        </>
      )}

      {value.type === 'WHATSAPP' && (
        <>
          <p className="text-xs text-gray-500">
            Подключите номер к 360dialog (BSP для WhatsApp Cloud API), вставьте API-ключ канала ниже —
            вебхук в 360dialog мы зарегистрируем автоматически.
          </p>
          <SecretField
            id="channel-wa360-token"
            label="360dialog API Key"
            value={value.wa360Token}
            onChange={(v) => set('wa360Token', v)}
            revealable={!!secretsRevealable}
            placeholder="D360-API-KEY"
          />
        </>
      )}

      {value.type === 'INSTAGRAM' && (
        <>
          <p className="text-xs text-gray-500">
            Нужна Facebook Page, привязанная к Instagram Professional аккаунту, и Page Access
            Token с правом instagram_manage_messages. Подписку Page на вебхуки мы оформим
            автоматически — единый Callback URL для всех Instagram-каналов настраивается один
            раз в Meta App Dashboard (см. README/доку по интеграции).
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="channel-ig-page-id">Facebook Page ID</Label>
            <Input id="channel-ig-page-id" value={value.igPageId} onChange={(e) => set('igPageId', e.target.value)} />
          </div>
          <SecretField
            id="channel-ig-token"
            label="Page Access Token"
            value={value.igAccessToken}
            onChange={(v) => set('igAccessToken', v)}
            revealable={!!secretsRevealable}
          />
        </>
      )}
    </>
  );
}

// Аватар канала/бота — подтягивается отдельным авторизованным запросом (не голым <img src>,
// у API нет cookie-сессии, только Bearer-токен в заголовке) и кэшируется как blob/object URL.
function ChannelAvatar({ channelId, hasAvatar, fallbackLetter }: { channelId: string; hasAvatar: boolean; fallbackLetter: string }) {
  const { data: url } = useQuery({
    queryKey: ['channel-avatar', channelId],
    queryFn: async () => URL.createObjectURL((await api.get(`/channels/${channelId}/avatar`, { responseType: 'blob' })).data as Blob),
    enabled: hasAvatar,
    staleTime: Infinity,
    retry: false,
  });

  if (url) return <img src={url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0 border" />;
  return (
    <div className="w-10 h-10 rounded-full bg-gray-100 border flex items-center justify-center text-sm font-medium text-gray-400 shrink-0">
      {fallbackLetter.charAt(0).toUpperCase() || '?'}
    </div>
  );
}

function ChannelsTab({ projectId, channels }: { projectId: string; channels: Project['channels'] }) {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<ChannelFormState>(EMPTY_CHANNEL_FORM);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const addChannel = useMutation({
    mutationFn: () => api.post('/channels', { projectId, type: form.type, ...channelFormToPayload(form) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setShowAddForm(false);
      setForm(EMPTY_CHANNEL_FORM);
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось добавить канал'),
  });

  const deactivateChannel = useMutation({
    mutationFn: (channelId: string) => api.delete(`/channels/${channelId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  const reactivateChannel = useMutation({
    mutationFn: (channelId: string) => api.post(`/channels/${channelId}/reactivate`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 space-y-3">
          {channels.length === 0 && <p className="text-sm text-gray-500">Каналы не привязаны.</p>}
          {channels.map((channel) => {
            const title = channel.tgChannelTitle || channel.tgBotFirstName;
            const handle = channel.tgChannelUsername || channel.tgBotUsername || channel.tgPersonalUsername;
            return (
              <div key={channel.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-0">
                <div className="flex items-center gap-3 min-w-0">
                  {channel.type === 'TELEGRAM' && (
                    <ChannelAvatar channelId={channel.id} hasAvatar={!!channel.tgAvatarFileId} fallbackLetter={title || handle || channel.type} />
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
                      <span className="text-sm text-gray-500">{channel.isActive ? 'Активен' : 'Отключён'}</span>
                    </div>
                    {(title || handle) && (
                      <div className="text-sm">
                        {title && <span className="font-medium">{title}</span>}
                        {handle && (
                          <a
                            href={`https://t.me/${handle.replace(/^@/, '')}`}
                            target="_blank"
                            rel="noopener"
                            className="text-gray-500 ml-1.5 hover:underline"
                          >
                            @{handle.replace(/^@/, '')}
                          </a>
                        )}
                        {channel.tgChannelMembersCount != null && (
                          <span className="text-gray-400 ml-1.5 inline-flex items-center gap-0.5">
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
                  <Button size="sm" variant="ghost" onClick={() => setEditingChannelId(channel.id)}>
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
                    <Button size="sm" variant="ghost" onClick={() => deactivateChannel.mutate(channel.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {!showAddForm && (
        <Button variant="outline" onClick={() => setShowAddForm(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Добавить канал
        </Button>
      )}

      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Новый канал</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ChannelFieldsEditor value={form} onChange={setForm} />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={() => addChannel.mutate()} disabled={!channelFormCanSubmit(form) || addChannel.isPending}>
                {addChannel.isPending ? 'Добавляем...' : 'Добавить'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowAddForm(false);
                  setForm(EMPTY_CHANNEL_FORM);
                }}
              >
                Отмена
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <EditChannelDialog
        channelId={editingChannelId}
        projectId={projectId}
        onClose={() => setEditingChannelId(null)}
      />
    </div>
  );
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
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить канал'),
  });

  return (
    <Dialog open={!!channelId} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Редактировать канал</DialogTitle>
        </DialogHeader>
        {isLoading && <p className="text-sm text-gray-500">Загрузка...</p>}
        {form && (
          <div className="space-y-3">
            <ChannelFieldsEditor value={form} onChange={setForm} lockType secretsRevealable />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={() => save.mutate()} disabled={!channelFormCanSubmit(form) || save.isPending}>
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

function PixelsTab({ projectId, pixels }: { projectId: string; pixels: Pixel[] }) {
  const queryClient = useQueryClient();
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
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось добавить пиксель'),
  });

  const deactivatePixel = useMutation({
    mutationFn: (pixelId: string) => api.delete(`/pixels/${pixelId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 space-y-3">
          {pixels.length === 0 && <p className="text-sm text-gray-500">Пиксели не привязаны.</p>}
          {pixels.map((pixel) => (
            <div key={pixel.id} className="flex items-center justify-between py-2 border-b last:border-0">
              <div className="flex items-center gap-2">
                <Badge variant={pixel.isActive ? 'outline' : 'destructive'}>{PLATFORM_LABEL[pixel.platform]}</Badge>
                <span className="text-sm">{pixel.label || pixel.pixelId}</span>
                <span className="text-sm text-gray-400">{pixel.isActive ? 'Активен' : 'Отключён'}</span>
              </div>
              {pixel.isActive && (
                <Button size="sm" variant="ghost" onClick={() => deactivatePixel.mutate(pixel.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {!showAddForm && (
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
            <p className="text-xs text-gray-500">
              Проект не привязан к одной платформе — можно добавить сколько угодно пикселей любых платформ одновременно
              (несколько FB-аккаунтов, FB + TikTok и т.д.). Каждое событие уйдёт во все активные пиксели проекта.
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
              </div>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={() => addPixel.mutate()} disabled={!pixelId || !accessToken || addPixel.isPending}>
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
  );
}

function IntegrationTab({ projectId, allowedDomains }: { projectId: string; allowedDomains: string[] }) {
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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ключи доступа</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="public-token">Public Token</Label>
            <div className="flex gap-2">
              <Input id="public-token" readOnly value={snippet?.publicToken || ''} />
              <Button size="icon" variant="outline" onClick={() => copyToClipboard(snippet?.publicToken || '')}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="secret-key">Secret Key</Label>
            <div className="flex gap-2">
              <Input id="secret-key" readOnly type={showSecret ? 'text' : 'password'} value={project?.secretKey || ''} />
              <Button size="icon" variant="outline" onClick={() => setShowSecret((s) => !s)}>
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
              <Button size="icon" variant="outline" onClick={() => copyToClipboard(project?.secretKey || '')}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm('Старые ключи перестанут работать немедленно. Продолжить?')) regenerate.mutate();
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
      <pre className="text-xs bg-gray-900 text-gray-100 rounded-lg p-3 pr-10 overflow-x-auto">{code}</pre>
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
          <div className="text-sm text-gray-500">Проект и все данные останутся в системе, но станут недоступны.</div>
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
