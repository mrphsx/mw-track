'use client';

// Редактор конструктора лендингов — отдельная страница (запрос пользователя 2026-10-21: «вынесем
// конструктор как отдельный вид создания лендинга на отдельную страницу»). Слева — общие
// настройки и список шагов, в центре — живой предпросмотр (его рендерит сервер тем же шаблоном,
// что и настоящий лендинг), справа — настройки выбранного шага: текст, кнопки, оформление.
//
// Новый лендинг создаётся только по кнопке «Создать»: фото фона и своя аватарка до этого хранятся
// в браузере и загружаются сразу после создания. У существующего лендинга файлы загружаются сразу.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  HelpCircle,
  ImagePlus,
  Monitor,
  Palette,
  Plus,
  Smartphone,
  Trash2,
  UserSquare2,
  X,
} from 'lucide-react';
import { api, API_BASE_URL } from '@/lib/api';
import { cn } from '@/lib/utils';
import { DomainOption, NO_DOMAIN, attachLandingToDomain, hasChannelAvatar } from '@/lib/landings';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DomainSelect } from '@/components/landing-card';
import { STUDIO_CARD } from '../ui';
import { ColorInput, Field, Range, Section, Segmented, Toggle } from './controls';
import {
  ACTION_LABELS,
  ANIMATION_LABELS,
  BUILDER_TEMPLATE_ID,
  BuilderButton,
  BuilderConfig,
  BuilderScreen,
  FONT_OPTIONS,
  KIND_LABELS,
  MAX_BUTTONS,
  MAX_SCREENS,
  PRESETS,
  SHADOW_LABELS,
  STYLE_LABELS,
  ScreenStyle,
  defaultBuilderConfig,
  newChannelScreen,
  newQuestionScreen,
  normalizeBuilderConfig,
} from '@/components/landing-builder/builder-types';

interface LandingData {
  id: string;
  name: string;
  projectId: string;
  templateId: string | null;
  avatarKey: string | null;
  builderConfig: unknown;
  templateData: Record<string, string> | null;
}

interface ProjectInfo {
  id: string;
  name: string;
  channel: {
    id: string;
    type: string;
    tgChannelTitle: string | null;
    tgBotFirstName: string | null;
    tgChannelMembersCount: number | null;
    tgAvatarFileId: string | null;
    websiteFaviconUrl: string | null;
  } | null;
}

type Selection = 'global' | number;
type Tab = 'content' | 'buttons' | 'style';

const opts = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
const WEIGHTS = [400, 500, 600, 700, 800, 900].map((value) => ({ value, label: String(value) }));

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

function stripImageKey(config: BuilderConfig): BuilderConfig {
  const { imageKey: _ignored, ...background } = config.background;
  void _ignored;
  return { ...config, background };
}

export function LandingBuilderEditor({ landingId, initialProjectId }: { landingId?: string; initialProjectId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isNew = !landingId;

  const { data: landing } = useQuery({
    queryKey: ['landing', landingId, 'builder'],
    queryFn: async () => (await api.get<LandingData>(`/landings/${landingId}`)).data,
    enabled: !!landingId,
  });

  const [config, setConfig] = useState<BuilderConfig>(() => defaultBuilderConfig());
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState(initialProjectId ?? '');
  const [domainId, setDomainId] = useState(NO_DOMAIN);
  const [selection, setSelection] = useState<Selection>(0);
  const [tab, setTab] = useState<Tab>('content');
  const [device, setDevice] = useState<'phone' | 'desktop'>('phone');
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  // Загрузка существующего лендинга — один раз.
  const loaded = useRef(false);
  useEffect(() => {
    if (!landing || loaded.current) return;
    loaded.current = true;
    const cfg = normalizeBuilderConfig(landing.builderConfig);
    setConfig(cfg);
    setName(landing.name);
    setProjectId(landing.projectId);
    setSavedSnapshot(JSON.stringify({ name: landing.name, cfg: stripImageKey(cfg) }));
  }, [landing]);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectInfo[]>('/projects')).data,
    enabled: isNew && !initialProjectId,
  });
  const { data: project } = useQuery({
    queryKey: ['project', projectId, 'builder-info'],
    queryFn: async () => (await api.get<ProjectInfo>(`/projects/${projectId}`)).data,
    enabled: !!projectId,
  });
  const { data: domains } = useQuery({
    queryKey: ['domains'],
    queryFn: async () => (await api.get<DomainOption[]>('/domains')).data,
    enabled: isNew,
  });

  // Аватар канала для нового лендинга (у существующего его отдаёт публичный эндпоинт лендинга).
  const channel = project?.channel ?? null;
  const { data: channelAvatarBlob } = useQuery({
    queryKey: ['channel-avatar', channel?.id],
    queryFn: async () => URL.createObjectURL((await api.get(`/channels/${channel!.id}/avatar`, { responseType: 'blob' })).data as Blob),
    enabled: isNew && !!channel && hasChannelAvatar(channel),
    staleTime: Infinity,
    retry: false,
  });

  const bgFileUrl = useObjectUrl(bgFile);
  const avatarFileUrl = useObjectUrl(avatarFile);
  const savedBgKey = (landing?.builderConfig as { background?: { imageKey?: string | null } } | undefined)?.background?.imageKey ?? null;
  const [bgKeyVersion, setBgKeyVersion] = useState<string | null>(null);
  const currentBgKey = bgKeyVersion ?? savedBgKey;
  const imageUrl = bgFileUrl ?? (landingId && currentBgKey ? `${API_BASE_URL}/landings/${landingId}/builder-background?v=${encodeURIComponent(currentBgKey.split('/').pop() ?? '')}` : null);
  const [avatarVersion, setAvatarVersion] = useState<string | null>(null);
  const avatarUrl =
    avatarFileUrl ??
    (landingId ? `${API_BASE_URL}/landings/${landingId}/avatar?v=${encodeURIComponent(avatarVersion ?? landing?.avatarKey ?? 'channel')}` : channelAvatarBlob ?? null);

  const channelTitle = landing?.templateData?.CHANNEL_TITLE || channel?.tgChannelTitle || channel?.tgBotFirstName || 'Ваш канал';
  const subscribersCount =
    landing?.templateData?.SUBSCRIBERS_COUNT || (channel?.tgChannelMembersCount != null ? channel.tgChannelMembersCount.toLocaleString('ru-RU') : '12 480');

  // ---- изменения конфига ----
  const set = (patch: Partial<BuilderConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const setBg = (patch: Partial<BuilderConfig['background']>) => setConfig((c) => ({ ...c, background: { ...c.background, ...patch } }));
  const screenIndex = typeof selection === 'number' ? Math.min(selection, config.screens.length - 1) : null;
  const screen = screenIndex !== null ? config.screens[screenIndex] : null;
  const setScreen = (patch: Partial<BuilderScreen>) =>
    setConfig((c) => ({ ...c, screens: c.screens.map((s, i) => (i === screenIndex ? { ...s, ...patch } : s)) }));
  const setStyle = (patch: Partial<ScreenStyle>) => screen && setScreen({ style: { ...screen.style, ...patch } });
  const setButton = (bi: number, patch: Partial<BuilderButton>) => screen && setScreen({ buttons: screen.buttons.map((b, j) => (j === bi ? { ...b, ...patch } : b)) });
  const moveScreen = (i: number, dir: -1 | 1) =>
    setConfig((c) => {
      const screens = [...c.screens];
      [screens[i], screens[i + dir]] = [screens[i + dir], screens[i]];
      return { ...c, screens };
    });
  const addScreen = (s: BuilderScreen) => {
    if (config.screens.length >= MAX_SCREENS) return;
    setConfig((c) => ({ ...c, screens: [...c.screens, s] }));
    setSelection(config.screens.length);
    setTab('content');
  };

  const dirty = savedSnapshot === null ? true : savedSnapshot !== JSON.stringify({ name, cfg: stripImageKey(config) });
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ---- предпросмотр ----
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api.post<string>(
          '/landings/builder/preview',
          {
            config: stripImageKey(config),
            ...(imageUrl ? { imageUrl } : {}),
            ...(avatarUrl ? { avatarUrl } : {}),
            channelTitle,
            subscribersCount,
            startScreen: screenIndex ?? 0,
          },
          { responseType: 'text' },
        );
        if (!cancelled) {
          setPreviewHtml(res.data);
          setPreviewFailed(false);
        }
      } catch {
        if (!cancelled) setPreviewFailed(true);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config, imageUrl, avatarUrl, channelTitle, subscribersCount, screenIndex]);

  // ---- сохранение ----
  const errorMessage = (err: unknown, fallback: string) => (isAxiosError(err) && err.response?.data?.error?.message) || fallback;

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Введите название лендинга');
      if (isNew) {
        if (!projectId) throw new Error('Выберите проект');
        const created = (
          await api.post<{ id: string }>(`/projects/${projectId}/landings`, {
            name: name.trim(),
            templateId: BUILDER_TEMPLATE_ID,
            channelTitle: channelTitle,
            builderConfig: stripImageKey(config),
          })
        ).data;
        if (bgFile && config.background.type === 'image') {
          const fd = new FormData();
          fd.append('file', bgFile);
          await api.post(`/landings/${created.id}/builder-background`, fd).catch(() => undefined);
        }
        if (avatarFile) {
          const fd = new FormData();
          fd.append('file', avatarFile);
          await api.post(`/landings/${created.id}/avatar`, fd).catch(() => undefined);
        }
        if (domainId !== NO_DOMAIN) await attachLandingToDomain(projectId, created.id, domainId, domains);
        return { created: created.id };
      }
      await api.patch(`/landings/${landingId}`, { name: name.trim(), builderConfig: stripImageKey(config) });
      return { created: null };
    },
    onSuccess: ({ created }) => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['landings'] });
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      if (created) {
        setSavedSnapshot(JSON.stringify({ name, cfg: stripImageKey(config) }));
        router.replace(`/projects/${projectId}/landings/${created}/builder?created=1`);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['landing', landingId] });
      setSavedSnapshot(JSON.stringify({ name, cfg: stripImageKey(config) }));
      setNotice('Сохранено');
      setTimeout(() => setNotice(''), 2500);
    },
    onError: (err) => setError(err instanceof Error && !isAxiosError(err) ? err.message : errorMessage(err, 'Не удалось сохранить')),
  });

  const uploadBg = useMutation({
    mutationFn: async (file: File | null) => {
      if (!landingId) {
        setBgFile(file);
        return null;
      }
      if (!file) {
        await api.delete(`/landings/${landingId}/builder-background`);
        return '';
      }
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<{ builderConfig: { background?: { imageKey?: string | null } } }>(`/landings/${landingId}/builder-background`, fd);
      return res.data.builderConfig?.background?.imageKey ?? '';
    },
    onSuccess: (key) => key !== null && setBgKeyVersion(key),
    onError: (err) => setError(errorMessage(err, 'Не удалось загрузить фото')),
  });

  const uploadAvatar = useMutation({
    mutationFn: async (file: File | null) => {
      if (!landingId) {
        setAvatarFile(file);
        return null;
      }
      if (!file) {
        await api.delete(`/landings/${landingId}/avatar`);
        return 'channel';
      }
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<{ avatarKey: string | null }>(`/landings/${landingId}/avatar`, fd);
      return res.data.avatarKey ?? 'channel';
    },
    onSuccess: (v) => v !== null && setAvatarVersion(v),
    onError: (err) => setError(errorMessage(err, 'Не удалось загрузить аватар')),
  });

  const created = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('created') === '1';
  useEffect(() => {
    if (!created) return;
    setNotice('Лендинг создан');
    const t = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [created]);

  if (landingId && !landing) return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка…</p>;
  if (landing && landing.templateId !== BUILDER_TEMPLATE_ID) {
    return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Этот лендинг создан не в конструкторе.</p>;
  }

  const backHref = landingId ? `/projects/${projectId}/landings/${landingId}` : projectId ? `/projects/${projectId}/landings` : '/landings';

  return (
    <div className="space-y-4">
      {/* Верхняя панель */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]">
          <ArrowLeft className="w-4 h-4" /> Назад
        </Link>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название лендинга (внутреннее)"
          className="h-9 w-full sm:w-72 bg-white dark:bg-[#171F2B]"
        />
        {isNew && !initialProjectId && (
          <div className="w-full sm:w-56">
            <Select value={projectId || undefined} onValueChange={(v) => v && setProjectId(v)}>
              <SelectTrigger className="h-9 bg-white dark:bg-[#171F2B]">
                <SelectValue>{(v: string) => (v ? (projects?.find((p) => p.id === v)?.name ?? v) : 'Выберите проект')}</SelectValue>
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
        {isNew && (
          <div className="w-full sm:w-56">
            <DomainSelect value={domainId} onChange={setDomainId} domains={domains} />
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          {notice && <span className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</span>}
          {!isNew && dirty && !notice && <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Есть несохранённые изменения</span>}
          <Button onClick={() => save.mutate()} disabled={save.isPending || (!isNew && !dirty)}>
            {save.isPending ? 'Сохраняем…' : isNew ? 'Создать лендинг' : 'Сохранить'}
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_380px]">
        {/* Левая колонка: общие настройки и шаги */}
        <div className={cn(STUDIO_CARD, 'p-3 space-y-1 self-start')}>
          <StepItem active={selection === 'global'} onClick={() => setSelection('global')} icon={<Palette className="w-4 h-4" />} title="Фон и шрифт" subtitle="Общие настройки" />
          <div className="pt-2 pb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-[#8A95A3] dark:text-[#7D8A99]">Шаги</div>
          {config.screens.map((s, i) => (
            <div key={i} className="group">
              <StepItem
                active={selection === i}
                onClick={() => setSelection(i)}
                icon={s.kind === 'channel' ? <UserSquare2 className="w-4 h-4" /> : <HelpCircle className="w-4 h-4" />}
                title={`${i + 1}. ${KIND_LABELS[s.kind]}`}
                subtitle={(s.title || '—').replace('{channel}', channelTitle)}
              />
              {selection === i && (
                <div className="flex items-center gap-0.5 px-2 pb-1">
                  <IconBtn title="Выше" disabled={i === 0} onClick={() => { moveScreen(i, -1); setSelection(i - 1); }}><ArrowUp className="w-3.5 h-3.5" /></IconBtn>
                  <IconBtn title="Ниже" disabled={i === config.screens.length - 1} onClick={() => { moveScreen(i, 1); setSelection(i + 1); }}><ArrowDown className="w-3.5 h-3.5" /></IconBtn>
                  <IconBtn title="Дублировать" disabled={config.screens.length >= MAX_SCREENS} onClick={() => addScreen(structuredClone(s))}><Copy className="w-3.5 h-3.5" /></IconBtn>
                  <IconBtn
                    title="Удалить шаг"
                    disabled={config.screens.length <= 1}
                    onClick={() => {
                      setConfig((c) => ({ ...c, screens: c.screens.filter((_, j) => j !== i) }));
                      setSelection(Math.max(0, i - 1));
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </IconBtn>
                </div>
              )}
            </div>
          ))}
          {config.screens.length < MAX_SCREENS && (
            <div className="pt-2 space-y-1">
              <AddBtn onClick={() => addScreen(newQuestionScreen(config.screens[config.screens.length - 1]?.style))}>Вопрос</AddBtn>
              <AddBtn onClick={() => addScreen(newChannelScreen())}>Карточка канала</AddBtn>
            </div>
          )}
          <p className="px-2 pt-2 text-[11px] leading-snug text-[#8A95A3] dark:text-[#7D8A99]">
            Посетитель видит шаги по порядку. Кнопка «След. шаг» открывает следующий, на последнем шаге она ведёт в канал.
          </p>
        </div>

        {/* Предпросмотр */}
        <div className="min-w-0 xl:order-none lg:col-start-2 xl:col-start-2">
          <div className="xl:sticky xl:top-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Так увидит посетитель{screenIndex !== null ? ` · шаг ${screenIndex + 1}` : ''}</span>
              <Segmented
                size="sm"
                value={device}
                onChange={setDevice}
                options={[
                  { value: 'phone', label: 'Телефон' },
                  { value: 'desktop', label: 'Компьютер' },
                ]}
              />
            </div>
            <div className="flex justify-center">
              <div
                className={cn(
                  'overflow-hidden bg-black transition-all',
                  device === 'phone' ? 'w-[340px] max-w-full h-[680px] rounded-[36px] border-[6px] border-[#131A24] dark:border-[#2A3546]' : 'w-full h-[620px] rounded-xl border border-[#DCE1E8] dark:border-white/10',
                )}
              >
                {previewHtml ? (
                  <iframe title="Предпросмотр конструктора" srcDoc={previewHtml} sandbox="allow-scripts allow-same-origin" className="h-full w-full border-0" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-white/60">{previewFailed ? 'Превью не загрузилось' : 'Загружаем…'}</div>
                )}
              </div>
            </div>
            <div className="flex justify-center gap-2 text-[#8A95A3]">
              {device === 'phone' ? <Smartphone className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
              {previewFailed && previewHtml && <span className="text-xs text-red-500">Не удалось обновить превью — проверьте поля</span>}
            </div>
          </div>
        </div>

        {/* Правая колонка: настройки */}
        <div className={cn(STUDIO_CARD, 'p-4 space-y-4 self-start lg:col-span-2 xl:col-span-1 xl:col-start-3 xl:row-start-1')}>
          {selection === 'global' || !screen ? (
            <GlobalPanel
              config={config}
              set={set}
              setBg={setBg}
              setConfig={(c) => {
                setConfig({ ...c, background: { ...c.background, imageKey: config.background.imageKey } });
                setSelection(0);
              }}
              imageUrl={imageUrl}
              onPickImage={(f) => uploadBg.mutate(f)}
              imageBusy={uploadBg.isPending}
            />
          ) : (
            <>
              <div className="space-y-2.5">
                <h3 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">
                  Шаг {screenIndex! + 1}: {KIND_LABELS[screen.kind]}
                </h3>
                <Segmented
                  size="sm"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: 'content', label: 'Текст' },
                    { value: 'buttons', label: 'Кнопки' },
                    { value: 'style', label: 'Оформление' },
                  ]}
                />
              </div>
              {tab === 'content' && (
                <ContentPanel
                  screen={screen}
                  setScreen={setScreen}
                  avatarUrl={avatarUrl}
                  onPickAvatar={(f) => uploadAvatar.mutate(f)}
                  avatarBusy={uploadAvatar.isPending}
                  hasOwnAvatar={!!avatarFile || (!!landingId && (avatarVersion ? avatarVersion !== 'channel' : !!landing?.avatarKey))}
                />
              )}
              {tab === 'buttons' && <ButtonsPanel screen={screen} setScreen={setScreen} setButton={setButton} isLast={screenIndex === config.screens.length - 1} />}
              {tab === 'style' && (
                <StylePanel
                  screen={screen}
                  setStyle={setStyle}
                  applyToAll={() => setConfig((c) => ({ ...c, screens: c.screens.map((s) => ({ ...s, style: { ...screen.style, avatarSize: s.style.avatarSize } })) }))}
                  multiple={config.screens.length > 1}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StepItem({ active, onClick, icon, title, subtitle }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
        active ? 'bg-[#E8EEF8] dark:bg-[#7BA9EE]/15' : 'hover:bg-[#F3F5F8] dark:hover:bg-white/5',
      )}
    >
      <span className={cn('mt-0.5 shrink-0', active ? 'text-[#1F4E9C] dark:text-[#7BA9EE]' : 'text-[#5F6B7A] dark:text-[#92A0AF]')}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[#131A24] dark:text-[#E9EDF3]">{title}</span>
        <span className="block truncate text-xs text-[#5F6B7A] dark:text-[#92A0AF]">{subtitle}</span>
      </span>
    </button>
  );
}

function IconBtn({ title, disabled, onClick, children }: { title: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-[#F3F5F8] dark:hover:bg-white/10 hover:text-[#131A24] dark:hover:text-[#E9EDF3] disabled:opacity-30 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

function AddBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 rounded-lg border border-dashed border-[#DCE1E8] dark:border-white/15 px-2.5 py-1.5 text-xs text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] hover:border-[#1F4E9C] dark:hover:border-[#7BA9EE]"
    >
      <Plus className="w-3.5 h-3.5" /> {children}
    </button>
  );
}

function FilePick({ label, onPick, busy }: { label: string; onPick: (f: File) => void; busy?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
      <Button type="button" size="sm" variant="outline" onClick={() => ref.current?.click()} disabled={busy}>
        <ImagePlus className="mr-1 h-3.5 w-3.5" /> {busy ? 'Загружаем…' : label}
      </Button>
    </>
  );
}

function GlobalPanel({
  config,
  set,
  setBg,
  setConfig,
  imageUrl,
  onPickImage,
  imageBusy,
}: {
  config: BuilderConfig;
  set: (p: Partial<BuilderConfig>) => void;
  setBg: (p: Partial<BuilderConfig['background']>) => void;
  setConfig: (c: BuilderConfig) => void;
  imageUrl: string | null;
  onPickImage: (f: File | null) => void;
  imageBusy: boolean;
}) {
  return (
    <>
      <h3 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Фон и шрифт</h3>
      <Section title="Заготовки">
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                if (window.confirm('Заготовка заменит все шаги и оформление. Продолжить?')) setConfig(structuredClone(p.config));
              }}
              className="rounded-lg border border-[#DCE1E8] dark:border-white/10 px-2.5 py-2 text-left text-xs text-[#131A24] dark:text-[#E9EDF3] hover:border-[#1F4E9C] dark:hover:border-[#7BA9EE]"
            >
              {p.label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Текст">
        <Field label="Шрифт" hint="Только шрифты, которые есть в любом браузере — страница грузится быстро.">
          <Select value={config.font} onValueChange={(v) => v && set({ font: v })}>
            <SelectTrigger className="h-8">
              <SelectValue>{(v: string) => FONT_OPTIONS.find((f) => f.value === v)?.label ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {FONT_OPTIONS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  <span style={{ fontFamily: f.css }}>{f.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Цвет текста">
            <ColorInput value={config.textColor} onChange={(v) => set({ textColor: v })} />
          </Field>
          <Field label="Акцент (кнопки)">
            <ColorInput value={config.accentColor} onChange={(v) => set({ accentColor: v })} />
          </Field>
        </div>
      </Section>
      <Section title="Фон страницы">
        <Segmented
          value={config.background.type}
          onChange={(type) => setBg({ type })}
          options={[
            { value: 'gradient', label: 'Градиент' },
            { value: 'color', label: 'Цвет' },
            { value: 'image', label: 'Фото' },
          ]}
        />
        {config.background.type === 'color' && (
          <Field label="Цвет">
            <ColorInput value={config.background.color} onChange={(v) => setBg({ color: v })} />
          </Field>
        )}
        {config.background.type === 'gradient' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Цвет 1">
                <ColorInput value={config.background.from} onChange={(v) => setBg({ from: v })} />
              </Field>
              <Field label="Цвет 2">
                <ColorInput value={config.background.to} onChange={(v) => setBg({ to: v })} />
              </Field>
            </div>
            <Field label="Направление">
              <Range value={config.background.angle} min={0} max={360} suffix="°" onChange={(v) => setBg({ angle: v })} />
            </Field>
          </>
        )}
        {config.background.type === 'image' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {imageUrl && <img src={imageUrl} alt="" className="h-12 w-12 rounded-md object-cover border border-[#DCE1E8] dark:border-white/10" />}
              <FilePick label={imageUrl ? 'Заменить фото' : 'Загрузить фото'} onPick={(f) => onPickImage(f)} busy={imageBusy} />
              {imageUrl && (
                <Button type="button" size="sm" variant="ghost" onClick={() => onPickImage(null)} disabled={imageBusy}>
                  <X className="mr-1 h-3.5 w-3.5" /> Убрать
                </Button>
              )}
            </div>
            {!imageUrl && <p className="text-[11px] text-[#8A95A3]">Пока фото нет, на странице будет градиент. JPG, PNG или WEBP до 5 МБ.</p>}
            <Field label="Затемнение">
              <Range value={config.background.dim} min={0} max={80} suffix="%" onChange={(v) => setBg({ dim: v })} />
            </Field>
            <Field label="Размытие">
              <Range value={config.background.blur} min={0} max={20} suffix="px" onChange={(v) => setBg({ blur: v })} />
            </Field>
            <Field label="Цвет под фото (пока грузится)">
              <ColorInput value={config.background.color} onChange={(v) => setBg({ color: v })} />
            </Field>
          </>
        )}
      </Section>
    </>
  );
}

function ContentPanel({
  screen,
  setScreen,
  avatarUrl,
  onPickAvatar,
  avatarBusy,
  hasOwnAvatar,
}: {
  screen: BuilderScreen;
  setScreen: (p: Partial<BuilderScreen>) => void;
  avatarUrl: string | null;
  onPickAvatar: (f: File | null) => void;
  avatarBusy: boolean;
  hasOwnAvatar: boolean;
}) {
  const isChannel = screen.kind === 'channel';
  return (
    <div className="space-y-4">
      {isChannel && (
        <Section title="Аватар">
          <Toggle label="Показывать аватар" checked={screen.showAvatar} onChange={(v) => setScreen({ showAvatar: v })} />
          {screen.showAvatar && (
            <div className="flex flex-wrap items-center gap-2">
              {avatarUrl && <img src={avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover border border-[#DCE1E8] dark:border-white/10" />}
              <FilePick label={hasOwnAvatar ? 'Заменить' : 'Своя картинка'} onPick={(f) => onPickAvatar(f)} busy={avatarBusy} />
              {hasOwnAvatar && (
                <Button type="button" size="sm" variant="ghost" onClick={() => onPickAvatar(null)} disabled={avatarBusy}>
                  Фото канала
                </Button>
              )}
            </div>
          )}
          {screen.showAvatar && <p className="text-[11px] text-[#8A95A3]">По умолчанию — фото канала проекта. Своя картинка общая для всего лендинга.</p>}
        </Section>
      )}
      <Section title="Текст">
        <Field label="Надпись сверху" hint="Мелко над заголовком, необязательно.">
          <Input value={screen.eyebrow} maxLength={80} onChange={(e) => setScreen({ eyebrow: e.target.value })} placeholder="Только для Польши 🇵🇱" />
        </Field>
        <Field label={isChannel ? 'Название' : 'Вопрос'} hint={isChannel ? '{channel} — название канала' : undefined}>
          <Input value={screen.title} maxLength={200} onChange={(e) => setScreen({ title: e.target.value })} />
        </Field>
        {isChannel && (
          <Field label="Подписчики" hint="{count} — число подписчиков канала. Оставьте пустым, чтобы скрыть.">
            <Input value={screen.subscribersText} maxLength={80} onChange={(e) => setScreen({ subscribersText: e.target.value })} />
          </Field>
        )}
        <Field label={isChannel ? 'Описание' : 'Пояснение'} hint="Необязательно. Перенос строки сохраняется.">
          <Textarea rows={3} value={screen.subtitle} maxLength={800} onChange={(e) => setScreen({ subtitle: e.target.value })} />
        </Field>
      </Section>
    </div>
  );
}

function ButtonsPanel({
  screen,
  setScreen,
  setButton,
  isLast,
}: {
  screen: BuilderScreen;
  setScreen: (p: Partial<BuilderScreen>) => void;
  setButton: (i: number, p: Partial<BuilderButton>) => void;
  isLast: boolean;
}) {
  const move = (i: number, dir: -1 | 1) => {
    const buttons = [...screen.buttons];
    [buttons[i], buttons[i + dir]] = [buttons[i + dir], buttons[i]];
    setScreen({ buttons });
  };
  return (
    <div className="space-y-3">
      {screen.buttons.length === 0 && <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">На этом шаге нет кнопок.</p>}
      {screen.buttons.map((b, i) => (
        <div key={i} className="space-y-2.5 rounded-lg border border-[#DCE1E8] dark:border-white/10 p-3">
          <div className="flex items-center gap-1">
            <Input value={b.text} maxLength={60} onChange={(e) => setButton(i, { text: e.target.value })} className="h-8 min-w-0 flex-1" />
            <IconBtn title="Выше" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="w-3.5 h-3.5" /></IconBtn>
            <IconBtn title="Ниже" disabled={i === screen.buttons.length - 1} onClick={() => move(i, 1)}><ArrowDown className="w-3.5 h-3.5" /></IconBtn>
            <IconBtn title="Удалить кнопку" onClick={() => setScreen({ buttons: screen.buttons.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
          </div>
          <Field label="Что делает">
            <Segmented size="sm" value={b.action} onChange={(action) => setButton(i, { action })} options={opts(ACTION_LABELS)} />
          </Field>
          {b.action === 'url' && <Input placeholder="https://..." value={b.url ?? ''} maxLength={500} onChange={(e) => setButton(i, { url: e.target.value.trim() })} className="h-8" />}
          {b.action === 'next' && isLast && <p className="text-[11px] text-[#8A95A3]">Это последний шаг — кнопка поведёт в канал.</p>}
          <Field label="Вид">
            <Segmented size="sm" value={b.style} onChange={(style) => setButton(i, { style })} options={opts(STYLE_LABELS)} />
          </Field>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Field label="Цвет">
              <ColorInput value={b.color} onChange={(color) => setButton(i, { color })} optional />
            </Field>
            <div className="w-36">
              <Toggle label="Пульсация" checked={b.pulse} onChange={(pulse) => setButton(i, { pulse })} />
            </div>
          </div>
        </div>
      ))}
      {screen.buttons.length < MAX_BUTTONS && (
        <AddBtn onClick={() => setScreen({ buttons: [...screen.buttons, { text: 'Кнопка', style: 'filled', action: 'telegram', color: '', pulse: false }] })}>Кнопка</AddBtn>
      )}
      <p className="text-[11px] leading-snug text-[#8A95A3]">
        «В канал» — переход в Telegram с отслеживанием (засчитывается клик). Если в попапе все кнопки с видом «Текст» и стоят в ряд — получится окно в стиле iOS.
      </p>
    </div>
  );
}

function StylePanel({ screen, setStyle, applyToAll, multiple }: { screen: BuilderScreen; setStyle: (p: Partial<ScreenStyle>) => void; applyToAll: () => void; multiple: boolean }) {
  const st = screen.style;
  return (
    <div className="space-y-4">
      <Section title="Попап">
        <Toggle label="Показывать в попапе" hint="Выключите, чтобы текст и кнопки были прямо на фоне." checked={st.card} onChange={(card) => setStyle({ card })} />
        {st.card && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Цвет попапа">
                <ColorInput value={st.cardColor} onChange={(cardColor) => setStyle({ cardColor })} />
              </Field>
              <Field label="Непрозрачность">
                <Range value={st.cardOpacity} min={0} max={100} suffix="%" onChange={(cardOpacity) => setStyle({ cardOpacity })} />
              </Field>
            </div>
            <Toggle label="Эффект стекла" hint="Размывает фон под полупрозрачным попапом." checked={st.glass} onChange={(glass) => setStyle({ glass })} />
            <Field label="Тень">
              <Segmented size="sm" value={st.shadow} onChange={(shadow) => setStyle({ shadow })} options={opts(SHADOW_LABELS)} />
            </Field>
            <Field label="Скругление углов">
              <Range value={st.radius} min={0} max={48} suffix="px" onChange={(radius) => setStyle({ radius })} />
            </Field>
          </>
        )}
        <Field label="Внутренние отступы">
          <Range value={st.padding} min={0} max={64} suffix="px" onChange={(padding) => setStyle({ padding })} />
        </Field>
        <Field label="Ширина">
          <Range value={st.width} min={220} max={720} step={10} suffix="px" onChange={(width) => setStyle({ width })} />
        </Field>
        <Field label="Появление">
          <Segmented size="sm" value={st.animation} onChange={(animation) => setStyle({ animation })} options={opts(ANIMATION_LABELS)} />
        </Field>
      </Section>
      <Section title="Текст">
        <Field label="Выравнивание">
          <Segmented size="sm" value={st.align} onChange={(align) => setStyle({ align })} options={[{ value: 'center', label: 'По центру' }, { value: 'left', label: 'Слева' }]} />
        </Field>
        <Field label="Размер заголовка">
          <Range value={st.titleSize} min={12} max={64} suffix="px" onChange={(titleSize) => setStyle({ titleSize })} />
        </Field>
        <Field label="Жирность заголовка">
          <Segmented size="sm" value={st.titleWeight} onChange={(titleWeight) => setStyle({ titleWeight })} options={WEIGHTS} />
        </Field>
        <Field label="Размер текста">
          <Range value={st.textSize} min={10} max={28} suffix="px" onChange={(textSize) => setStyle({ textSize })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Цвет заголовка">
            <ColorInput value={st.titleColor} onChange={(titleColor) => setStyle({ titleColor })} optional />
          </Field>
          <Field label="Цвет текста">
            <ColorInput value={st.textColor} onChange={(textColor) => setStyle({ textColor })} optional />
          </Field>
        </div>
        {screen.kind === 'channel' && (
          <Field label="Размер аватара">
            <Range value={st.avatarSize} min={32} max={200} suffix="px" onChange={(avatarSize) => setStyle({ avatarSize })} />
          </Field>
        )}
      </Section>
      <Section title="Кнопки">
        <Field label="Расположение">
          <Segmented size="sm" value={st.btnLayout} onChange={(btnLayout) => setStyle({ btnLayout })} options={[{ value: 'row', label: 'В ряд' }, { value: 'column', label: 'Столбиком' }]} />
        </Field>
        <Field label="Скругление">
          <Range value={Math.min(st.btnRadius, 40)} min={0} max={40} suffix={st.btnRadius >= 40 ? '+' : 'px'} onChange={(v) => setStyle({ btnRadius: v >= 40 ? 999 : v })} />
        </Field>
        <Field label="Высота">
          <Range value={st.btnHeight} min={32} max={80} suffix="px" onChange={(btnHeight) => setStyle({ btnHeight })} />
        </Field>
        <Field label="Размер шрифта">
          <Range value={st.btnSize} min={11} max={28} suffix="px" onChange={(btnSize) => setStyle({ btnSize })} />
        </Field>
        <Field label="Жирность">
          <Segmented size="sm" value={st.btnWeight} onChange={(btnWeight) => setStyle({ btnWeight })} options={WEIGHTS} />
        </Field>
      </Section>
      {multiple && (
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={applyToAll}>
          Применить это оформление ко всем шагам
        </Button>
      )}
    </div>
  );
}
