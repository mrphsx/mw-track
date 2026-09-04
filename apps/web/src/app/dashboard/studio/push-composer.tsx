'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';
import { zonedTimeToUtcIso, utcIsoToZonedParts, getBrowserTimezone } from '@/lib/timezone';
import { ChannelAvatar } from '@/components/channel-avatar';
import { hasChannelAvatar } from '@/lib/landings';
import { TimezoneInput } from '@/components/timezone-input';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { PushContentStep, PushContent } from '@/components/pushes/push-content-step';
import { PushAudienceStep, PushAudienceFilter } from '@/components/pushes/push-audience-step';
import { ScheduleCalendar } from '@/components/pushes/schedule-calendar';
import { STUDIO_CARD, StudioLinkButton } from './ui';

interface ProjectSummary {
  id: string;
  name: string;
  channel: { id: string; type: string; tgAvatarFileId: string | null; websiteFaviconUrl?: string | null } | null;
}

type SendMode = 'now' | 'scheduled';

// Та же логика, что и classic-версия (apps/web/src/components/pushes/push-composer.tsx) — см. её
// для полного комментария о единой странице создания рассылки, авто-выборе первого проекта и
// расчёте аудитории по всем проектам сразу. Здесь только Studio-оформление.
//
// Раскладка (запрос пользователя 2026-08-05, редизайн этой же страницы): верх — контент
// (PushContentStep уже сам grid "поля | предпросмотр"); низ — 2 колонки: слева компактный список
// каналов + расписание (с выбором часового пояса), справа фильтры получателей; кнопка "Создать
// рассылку" — отдельно внизу под обеими колонками.
function buildFilterPayload(filter: PushAudienceFilter) {
  return {
    channelTypes: filter.channelTypes.length ? filter.channelTypes : undefined,
    hasPurchase: filter.hasPurchase,
    countries: filter.countries
      ? filter.countries
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : undefined,
    minSpent: filter.minSpent ? Number(filter.minSpent) : undefined,
    inactiveDaysMin: filter.inactiveDaysMin ? Number(filter.inactiveDaysMin) : undefined,
  };
}

interface AudiencePreview {
  total: { audienceTotal: number; audienceReachable: number };
  byProject: { projectId: string; audienceTotal: number; audienceReachable: number }[];
}

// Форма ответа GET .../pushes/:id — только поля, нужные для предзаполнения формы редактирования.
interface PushDetail {
  id: string;
  name: string;
  messageText: string;
  messageMedia: { url: string; type: string }[] | null;
  buttons: { text: string; url: string }[] | null;
  filter: {
    channelTypes?: string[];
    hasPurchase?: boolean;
    countries?: string[];
    minSpent?: number;
    inactiveDaysMin?: number;
  };
  scheduledAt: string | null;
}

// pushId+editProjectId (запрос пользователя 2026-08-05) — та же логика редактирования, что и в
// classic-версии (apps/web/src/components/pushes/push-composer.tsx), см. её для полного
// комментария.
export function StudioPushComposer({
  initialProjectIds,
  pushId,
  editProjectId,
}: {
  initialProjectIds: string[];
  pushId?: string;
  editProjectId?: string;
}) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isEditMode = !!(pushId && editProjectId);

  const { data: allProjects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });

  // WEBSITE-проекты исключены (запрос пользователя 2026-09-03) — зеркалит классический
  // композер, см. его комментарий: getChannelUserId всегда null для WEBSITE-клиентов.
  const allowedProjects = useMemo(
    () => (allProjects ?? []).filter((p) => p.channel?.type !== 'WEBSITE' && hasPermission(user, p.id, 'PUSHES_CREATE')),
    [allProjects, user],
  );
  const projects = useMemo(
    () => (isEditMode ? allowedProjects.filter((p) => p.id === editProjectId) : allowedProjects),
    [allowedProjects, isEditMode, editProjectId],
  );

  const [selectedIds, setSelectedIds] = useState<string[]>(initialProjectIds);
  useEffect(() => {
    if (initialProjectIds.length) setSelectedIds((prev) => Array.from(new Set([...prev, ...initialProjectIds])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Автовыбор первого проекта, если ничего не предвыбрано — контент теперь идёт первым (выше
  // выбора проектов), а PushContentStep'у для загрузки медиа всё равно нужен projectId.
  useEffect(() => {
    if (selectedIds.length === 0 && projects.length > 0) setSelectedIds([projects[0].id]);
  }, [projects, selectedIds.length]);

  const toggleProject = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const [content, setContent] = useState<PushContent>({ name: '', messageText: '', media: [], buttons: [] });
  const [filter, setFilter] = useState<PushAudienceFilter>({
    channelTypes: [],
    hasPurchase: undefined,
    countries: '',
    minSpent: '',
    inactiveDaysMin: '',
  });
  const [isUploading, setIsUploading] = useState(false);
  const [sendMode, setSendMode] = useState<SendMode>('now');
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [timezone, setTimezone] = useState(getBrowserTimezone());

  // Предзаполнение формы существующим пушем (запрос пользователя 2026-08-05) — см. полный
  // комментарий в classic-версии.
  const { data: existingPush } = useQuery({
    queryKey: ['push', editProjectId, pushId],
    queryFn: async () => (await api.get<PushDetail>(`/projects/${editProjectId}/pushes/${pushId}`)).data,
    enabled: isEditMode,
  });
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (!existingPush || prefilledRef.current) return;
    prefilledRef.current = true;
    setContent({
      name: existingPush.name,
      messageText: existingPush.messageText,
      media: (existingPush.messageMedia ?? []).map((m) => ({ url: m.url, type: m.type as PushContent['media'][number]['type'] })),
      buttons: existingPush.buttons ?? [],
    });
    setFilter({
      channelTypes: existingPush.filter.channelTypes ?? [],
      hasPurchase: existingPush.filter.hasPurchase,
      countries: (existingPush.filter.countries ?? []).join(', '),
      minSpent: existingPush.filter.minSpent != null ? String(existingPush.filter.minSpent) : '',
      inactiveDaysMin: existingPush.filter.inactiveDaysMin != null ? String(existingPush.filter.inactiveDaysMin) : '',
    });
    if (existingPush.scheduledAt) {
      setSendMode('scheduled');
      const { dateStr: d, timeStr: t } = utcIsoToZonedParts(existingPush.scheduledAt, timezone);
      setDateStr(d);
      setTimeStr(t);
      setScheduledDate(new Date(`${d}T00:00:00`));
    } else {
      setSendMode('now');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingPush]);

  const [audience, setAudience] = useState<AudiencePreview | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  useEffect(() => {
    if (projects.length === 0) {
      setAudience(null);
      return;
    }
    setIsCalculating(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.post<AudiencePreview>('/pushes/preview-audience', {
          projectIds: projects.map((p) => p.id),
          filter: buildFilterPayload(filter),
        });
        setAudience(res.data);
      } finally {
        setIsCalculating(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [projects, filter]);

  const audienceByProject = new Map((audience?.byProject ?? []).map((p) => [p.projectId, p]));
  const selectedTotal = selectedIds.reduce(
    (acc, id) => {
      const p = audienceByProject.get(id);
      return p ? { audienceTotal: acc.audienceTotal + p.audienceTotal, audienceReachable: acc.audienceReachable + p.audienceReachable } : acc;
    },
    { audienceTotal: 0, audienceReachable: 0 },
  );

  const buildPayload = () => ({
    projectIds: selectedIds,
    name: content.name,
    messageText: content.messageText,
    // .map(({url,type}) => ...) — content.media несёт ещё и key (внутреннее поле
    // PushContentStep для переключения видео↔кружок без повторной загрузки) — бэкенд его не
    // знает, forbidNonWhitelisted отклонил бы весь запрос при лишнем поле.
    messageMedia: content.media.length ? content.media.map(({ url, type }) => ({ url, type })) : undefined,
    buttons: content.buttons.filter((b) => b.text && b.url).length ? content.buttons.filter((b) => b.text && b.url) : undefined,
    filter: buildFilterPayload(filter),
    sendNow: sendMode === 'now',
    scheduledAt: sendMode === 'scheduled' && dateStr && timeStr ? zonedTimeToUtcIso(dateStr, timeStr, timezone) : undefined,
  });

  // PATCH не отправляет рассылку — редактирование только сохраняет контент/аудиторию/расписание;
  // "sendMode==='now'" здесь означает "без расписания" → scheduledAt:null (откат в DRAFT).
  const buildEditPayload = () => ({
    name: content.name,
    messageText: content.messageText,
    messageMedia: content.media.length ? content.media.map(({ url, type }) => ({ url, type })) : undefined,
    buttons: content.buttons.filter((b) => b.text && b.url).length ? content.buttons.filter((b) => b.text && b.url) : undefined,
    filter: buildFilterPayload(filter),
    scheduledAt: sendMode === 'now' ? null : dateStr && timeStr ? zonedTimeToUtcIso(dateStr, timeStr, timezone) : undefined,
  });

  const submit = useMutation({
    mutationFn: async () =>
      isEditMode
        ? (await api.patch(`/projects/${editProjectId}/pushes/${pushId}`, buildEditPayload())).data
        : (await api.post('/pushes', buildPayload())).data,
    onSuccess: () => {
      if (isEditMode) {
        router.push(`/projects/${editProjectId}/pushes`);
      } else if (selectedIds.length === 1 && initialProjectIds.length === 1) {
        router.push(`/projects/${selectedIds[0]}/pushes`);
      } else {
        router.push('/pushes-calendar');
      }
    },
  });

  const canSubmit =
    selectedIds.length > 0 &&
    content.name.trim() &&
    content.messageText.trim() &&
    !isUploading &&
    (sendMode === 'now' || (dateStr && timeStr));

  const contentProjectId = selectedIds[0] ?? projects[0]?.id;

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">
        {isEditMode ? 'Редактирование рассылки' : 'Новая рассылка'}
      </h1>

      {projectsLoading ? null : projects.length === 0 ? (
        <div className={`${STUDIO_CARD} p-6 text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>Нет проектов с правом на создание рассылок</div>
      ) : (
        <>
          <div className={`${STUDIO_CARD} p-6`}>
            <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-3">Контент</h2>
            <PushContentStep projectId={contentProjectId} value={content} onChange={setContent} onUploadingChange={setIsUploading} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-4">
              <div className={STUDIO_CARD}>
                <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3] px-4 pt-4 pb-2">Проект</h2>
                {/* Режим редактирования: проект зафиксирован — статичная строка, не чекбокс-список. */}
                {isEditMode ? (
                  <div className="flex items-center gap-3 px-4 pb-4">
                    <ChannelAvatar channelId={projects[0]?.channel?.id ?? ''} hasAvatar={hasChannelAvatar(projects[0]?.channel)} fallbackLetter={projects[0]?.name ?? ''} />
                    <span className="font-medium text-[#131A24] dark:text-[#E9EDF3]">{projects[0]?.name}</span>
                  </div>
                ) : (
                <div className="max-h-64 overflow-y-auto divide-y divide-[#DCE1E8] dark:divide-white/10">
                  {projects.map((p) => {
                    const stat = audienceByProject.get(p.id);
                    return (
                      <label
                        key={p.id}
                        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[#F3F5F8] dark:hover:bg-white/5 transition-colors"
                      >
                        <Checkbox checked={selectedIds.includes(p.id)} onCheckedChange={() => toggleProject(p.id)} />
                        <ChannelAvatar channelId={p.channel?.id ?? ''} hasAvatar={hasChannelAvatar(p.channel)} fallbackLetter={p.name} />
                        <span className="flex-1 font-medium truncate text-[#131A24] dark:text-[#E9EDF3]">{p.name}</span>
                        <span className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] shrink-0">
                          Доступно: {stat ? stat.audienceReachable : isCalculating ? '…' : '—'}
                        </span>
                      </label>
                    );
                  })}
                </div>
                )}
              </div>

              <div className={`${STUDIO_CARD} p-4 space-y-4`}>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Расписание</h2>
                  {/* Чекбокс рядом вместо переключателя-таба (баг-репорт пользователя 2026-08-05:
                      "кнопка отправить уходит вниз когда открывается календарь") — календарь
                      всегда на месте, высота блока не меняется при переключении. */}
                  <label className="flex items-center gap-2 text-sm text-[#131A24] dark:text-[#E9EDF3] cursor-pointer">
                    <Checkbox checked={sendMode === 'now'} onCheckedChange={() => setSendMode(sendMode === 'now' ? 'scheduled' : 'now')} />
                    {isEditMode ? 'Без расписания' : 'Отправить сейчас'}
                  </label>
                </div>

                <div className={`space-y-3 ${sendMode === 'now' ? 'opacity-50 pointer-events-none' : ''}`}>
                  {/* По первому отмеченному проекту, даже если отмечено несколько (баг-репорт
                      пользователя 2026-08-05: "когда выбираю проект, календарь из расписания
                      теряется" — раньше требовалось ровно 1 выбранный проект). */}
                  {selectedIds.length > 0 && (
                    <ScheduleCalendar
                      projectId={selectedIds[0]}
                      selectedDate={scheduledDate}
                      onSelectDate={(d) => {
                        setScheduledDate(d);
                        setDateStr(d.toISOString().slice(0, 10));
                      }}
                    />
                  )}
                  <div className="flex gap-2">
                    <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} className="w-40 rounded-lg" />
                    <Input type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} className="w-32 rounded-lg" />
                  </div>
                  <TimezoneInput
                    value={timezone}
                    onChange={setTimezone}
                    id="studio-push-timezone"
                    label="Часовой пояс отправки"
                    hint="По умолчанию — ваш текущий пояс. Дата/время выше считаются в нём."
                  />
                </div>
              </div>
            </div>

            <div className={`${STUDIO_CARD} p-4`}>
              <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-3">Фильтры получателей</h2>
              <PushAudienceStep
                value={filter}
                onChange={setFilter}
                audienceTotal={audience ? selectedTotal.audienceTotal : null}
                audienceReachable={audience ? selectedTotal.audienceReachable : null}
                isCalculating={isCalculating}
                containerClassName={STUDIO_CARD}
              />
            </div>
          </div>

          {submit.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">{isEditMode ? 'Не удалось сохранить изменения' : 'Не удалось создать рассылку'}</p>
          )}

          <StudioLinkButton variant="primary" disabled={!canSubmit || submit.isPending} onClick={() => submit.mutate()}>
            {isEditMode ? (submit.isPending ? 'Сохраняем...' : 'Сохранить изменения') : submit.isPending ? 'Создаём...' : 'Создать рассылку'}
          </StudioLinkButton>
        </>
      )}
    </div>
  );
}
