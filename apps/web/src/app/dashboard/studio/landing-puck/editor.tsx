'use client';

// Визуальный редактор лендингов на Puck (запрос пользователя 2026-10-21: «интегрируй Puck как
// отдельный вид создания лендингов и настрой его под нас максимально»). Отдельно от конструктора:
// там готовые шаги с настройками, здесь — свободная страница из блоков (секции, колонки, карточки,
// шаги, попапы, кнопки с действиями, таймер, видео, свой HTML).
//
// Сохранение: состояние редактора (data) и собранная из него разметка (puck-export.tsx) уходят на
// сервер вместе, сервер подставляет разметку в templates/puck/template.html. Новый лендинг
// создаётся только по кнопке — до этого страница живёт в браузере.

import '@puckeditor/core/no-external.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowLeft, Check } from 'lucide-react';
import { Puck, type Data } from '@puckeditor/core';
import { api, API_BASE_URL } from '@/lib/api';
import { cn } from '@/lib/utils';
import { DomainOption, NO_DOMAIN, attachLandingToDomain, hasChannelAvatar } from '@/lib/landings';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DomainSelect } from '@/components/landing-card';
import { buildPuckConfig, type PuckMeta } from '@/components/puck/puck-config';
import { withDefaults } from '@/components/puck/puck-data';
import { renderPuckHtml } from '@/components/puck/puck-export';
import { PUCK_DICTIONARY_RU } from '@/components/puck/puck-dictionary';
import { PUCK_STARTERS } from '@/components/puck/puck-starters';

export const PUCK_TEMPLATE_ID = 'puck';

interface LandingData {
  id: string;
  name: string;
  projectId: string;
  templateId: string | null;
  avatarKey: string | null;
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

const VIEWPORTS = [
  { width: 390, height: 'auto' as const, label: 'Телефон', icon: 'Smartphone' as const },
  { width: 820, height: 'auto' as const, label: 'Планшет', icon: 'Tablet' as const },
  { width: 1280, height: 'auto' as const, label: 'Компьютер', icon: 'Monitor' as const },
];

const errorMessage = (err: unknown, fallback: string) =>
  (isAxiosError(err) && err.response?.data?.error?.message) || (err instanceof Error && !isAxiosError(err) ? err.message : fallback);

export function LandingPuckEditor({ landingId, initialProjectId }: { landingId?: string; initialProjectId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isNew = !landingId;

  const { data: landing } = useQuery({
    queryKey: ['landing', landingId, 'puck-landing'],
    queryFn: async () => (await api.get<LandingData>(`/landings/${landingId}`)).data,
    enabled: !!landingId,
  });
  const { data: content } = useQuery({
    queryKey: ['landing', landingId, 'puck-content'],
    queryFn: async () => (await api.get<{ data: Data | null }>(`/landings/${landingId}/puck`)).data,
    enabled: !!landingId && landing?.templateId === PUCK_TEMPLATE_ID,
    staleTime: 0,
    gcTime: 0,
  });

  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState(initialProjectId ?? '');
  const [domainId, setDomainId] = useState(NO_DOMAIN);
  const [starterData, setStarterData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const dataRef = useRef<Data | null>(null);

  useEffect(() => {
    if (landing) {
      setName(landing.name);
      setProjectId(landing.projectId);
    }
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

  const channel = project?.channel ?? null;
  const { data: channelAvatarBlob } = useQuery({
    queryKey: ['channel-avatar', channel?.id],
    queryFn: async () => URL.createObjectURL((await api.get(`/channels/${channel!.id}/avatar`, { responseType: 'blob' })).data as Blob),
    enabled: isNew && !!channel && hasChannelAvatar(channel),
    staleTime: Infinity,
  });

  const channelTitle = landing?.templateData?.CHANNEL_TITLE || channel?.tgChannelTitle || channel?.tgBotFirstName || 'Ваш канал';
  const subscribers =
    landing?.templateData?.SUBSCRIBERS_COUNT ||
    (channel?.tgChannelMembersCount != null ? channel.tgChannelMembersCount.toLocaleString('ru-RU') : '12 480');
  const avatarUrl = landingId ? `${API_BASE_URL}/landings/${landingId}/avatar?v=${encodeURIComponent(landing?.avatarKey ?? 'channel')}` : (channelAvatarBlob ?? null);

  const metadata = useMemo<PuckMeta>(() => ({ mode: 'edit', channel: { title: channelTitle, avatarUrl, subscribers } }), [channelTitle, avatarUrl, subscribers]);

  const upload = useCallback(
    async (file: File) => {
      if (!landingId && !projectId) throw new Error('Сначала выберите проект');
      const fd = new FormData();
      fd.append('file', file);
      if (landingId) fd.append('landingId', landingId);
      else fd.append('projectId', projectId);
      try {
        return (await api.post<{ url: string }>('/landings/puck-assets', fd)).data.url;
      } catch (err) {
        throw new Error(errorMessage(err, 'Не удалось загрузить картинку'));
      }
    },
    [landingId, projectId],
  );
  const config = useMemo(() => buildPuckConfig({ upload }), [upload]);

  const initialData = useMemo<Data | null>(() => {
    if (landingId) return content ? withDefaults(content.data ?? PUCK_STARTERS[3].build(), config) : null;
    return starterData ? withDefaults(starterData, config) : null;
    // config меняется только вместе с загрузчиком — данные редактора от этого не пересоздаём.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landingId, content, starterData]);

  useEffect(() => {
    if (initialData && !dataRef.current) dataRef.current = initialData;
  }, [initialData]);

  // Уход со страницы с несохранёнными изменениями — спросить.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async () => {
      const data = dataRef.current;
      if (!data) throw new Error('Страница ещё не загружена');
      if (!name.trim()) throw new Error('Введите название лендинга');
      const puckHtml = renderPuckHtml(data);
      if (isNew) {
        if (!projectId) throw new Error('Выберите проект');
        const created = (
          await api.post<{ id: string }>(`/projects/${projectId}/landings`, {
            name: name.trim(),
            templateId: PUCK_TEMPLATE_ID,
            channelTitle,
            puckData: data,
            puckHtml,
          })
        ).data;
        if (domainId !== NO_DOMAIN) await attachLandingToDomain(projectId, created.id, domainId, domains);
        return created.id;
      }
      await api.patch(`/landings/${landingId}`, { name: name.trim(), puckData: data, puckHtml });
      return null;
    },
    onSuccess: (createdId) => {
      setError('');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['landings'] });
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      if (createdId) {
        router.replace(`/projects/${projectId}/landings/${createdId}/puck?created=1`);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['landing', landingId] });
      setNotice('Сохранено');
      setTimeout(() => setNotice(''), 2500);
    },
    onError: (err) => setError(errorMessage(err, 'Не удалось сохранить')),
  });

  const created = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('created') === '1';
  useEffect(() => {
    if (!created) return;
    setNotice('Лендинг создан');
    const t = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [created]);

  if (landingId && !landing) return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка…</p>;
  if (landing && landing.templateId !== PUCK_TEMPLATE_ID) {
    return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Этот лендинг создан не в визуальном редакторе.</p>;
  }

  const backHref = landingId ? `/projects/${projectId}/landings/${landingId}` : projectId ? `/projects/${projectId}/landings` : '/landings';
  const saveLabel = save.isPending ? 'Сохраняем…' : isNew ? 'Создать лендинг' : 'Сохранить';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]">
          <ArrowLeft className="w-4 h-4" /> Назад
        </Link>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название лендинга (внутреннее)" className="h-9 w-full sm:w-72 bg-white dark:bg-[#171F2B]" />
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
        </div>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}

      {!initialData && isNew && <StarterPicker onPick={(d) => setStarterData(d)} />}
      {!initialData && !isNew && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка страницы…</p>}

      {initialData && (
        <div className="overflow-hidden rounded-xl border border-[#DCE1E8] dark:border-white/10 bg-white">
          <Puck
            config={config}
            data={initialData}
            metadata={metadata as Record<string, unknown>}
            dictionary={PUCK_DICTIONARY_RU}
            viewports={VIEWPORTS}
            ui={{ viewports: { current: { width: VIEWPORTS[0].width, height: 'auto' }, controlsVisible: true, options: VIEWPORTS } }}
            headerTitle={name || 'Новый лендинг'}
            height="calc(100dvh - 150px)"
            iframe={{ enabled: true, waitForStyles: true }}
            onChange={(data) => {
              if (dataRef.current && dataRef.current !== data) setDirty(true);
              dataRef.current = data;
            }}
            overrides={{
              headerActions: () => (
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || (!isNew && !dirty)}>
                  {!isNew && !dirty ? <Check className="w-4 h-4 mr-1" /> : null}
                  {!isNew && !dirty ? 'Сохранено' : saveLabel}
                </Button>
              ),
            }}
          />
        </div>
      )}
    </div>
  );
}

function StarterPicker({ onPick }: { onPick: (data: Data) => void }) {
  return (
    <div className="rounded-xl border border-[#DCE1E8] dark:border-white/10 bg-white dark:bg-[#171F2B] p-5">
      <h2 className="text-base font-semibold text-[#131A24] dark:text-[#E9EDF3]">С чего начнём?</h2>
      <p className="mt-1 text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Заготовку потом можно менять как угодно: добавлять блоки, перетаскивать, удалять.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {PUCK_STARTERS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.build())}
            className={cn(
              'rounded-lg border border-[#DCE1E8] dark:border-white/10 p-4 text-left transition-colors',
              'hover:border-[#1F4E9C] hover:bg-[#F3F6FB] dark:hover:border-[#7BA9EE] dark:hover:bg-white/5',
            )}
          >
            <div className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">{s.label}</div>
            <div className="mt-1 text-xs text-[#5F6B7A] dark:text-[#92A0AF]">{s.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
