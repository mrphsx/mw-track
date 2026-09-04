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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PushContentStep, PushContent } from './push-content-step';
import { PushAudienceStep, PushAudienceFilter } from './push-audience-step';
import { ScheduleCalendar } from './schedule-calendar';

interface ProjectSummary {
  id: string;
  name: string;
  channel: { id: string; type: string; tgAvatarFileId: string | null; websiteFaviconUrl?: string | null } | null;
}

type SendMode = 'now' | 'scheduled';

// Форма хранит фильтр в UI-удобном виде (строки для полей ввода) — тот же transform, что и
// прежний мастер (buildFilterPayload в projects/[id]/pushes/new/page.tsx), перед отправкой на
// бэкенд, который ждёт PushFilterDto (массив стран, числа).
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

// Форма ответа GET .../pushes/:id (тот же Push, что возвращает бэкенд) — только поля, нужные
// для предзаполнения формы редактирования.
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

// Единая страница создания рассылки (запрос пользователя 2026-08-04: "все части создания пуша
// на одну страницу чтобы человек не делал лишних кликов подтверждения") — заменяет собой
// прежний 3-шаговый мастер. Переиспользует PushContentStep/PushAudienceStep/ScheduleCalendar
// без изменений — они уже были общими между classic/Studio и не завязаны на пошаговую механику
// родителя.
//
// Раскладка (запрос пользователя 2026-08-05, редизайн этой же страницы): верх — контент
// (PushContentStep уже сам по себе grid "поля | предпросмотр", ничего дополнительно делать не
// нужно); низ — 2 колонки: слева компактный список каналов + расписание, справа фильтры
// получателей; кнопка "Создать рассылку" — отдельно внизу под обеими колонками, не привязана ни
// к одной из них. Раз контент теперь идёт ПЕРВЫМ (выше выбора проектов), а PushContentStep'у для
// загрузки медиа всё равно нужен конкретный projectId — при пустом initialProjectIds первый
// загрузившийся проект выбирается автоматически (см. эффект ниже), иначе форма стартовала бы в
// нерабочем состоянии.
//
// Один и тот же компонент обслуживает вход со страницы конкретного проекта (initialProjectIds=[id])
// и с company-wide страницы "Рассылки" (initialProjectIds=[]). Мульти-проектный выбор — реальная
// новая возможность (Push.projectId — одиночное поле в схеме, фан-аут делает бэкенд POST /pushes
// через createForProjects), поэтому шлём всегда через company-wide эндпоинт, даже при одном
// выбранном проекте.
// pushId+editProjectId (запрос пользователя 2026-08-05: "добавь возможность редактирования
// существующих рассылок запланированных") — включают режим редактирования: содержимое
// предзаполняется из GET .../pushes/:id, выбор проекта фиксируется на editProjectId (Push
// привязан к ровно одному проекту в схеме, мульти-выбор в этом режиме не имеет смысла), а сабмит
// шлёт PATCH вместо POST. Оба пропа нужны вместе — Push существует только внутри одного проекта,
// эндпоинт PATCH /projects/:projectId/pushes/:id требует его явно.
export function PushComposer({
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

  // WEBSITE-проекты исключены (запрос пользователя 2026-09-03: "не понимаю как работает
  // рассылка на таких проектах, там вроде нет бота... убери такие типы проекта из рассылок") —
  // ChannelsService.sendMessage резолвит получателя через getChannelUserId, который для
  // WEBSITE-клиентов всегда null (у них только visitorId) — рассылка гарантированно провалит
  // КАЖДОГО получателя, показывать такой проект в выборе было бы просто ловушкой.
  const allowedProjects = useMemo(
    () => (allProjects ?? []).filter((p) => p.channel?.type !== 'WEBSITE' && hasPermission(user, p.id, 'PUSHES_CREATE')),
    [allProjects, user],
  );
  // В режиме редактирования список сужается до ЕДИНСТВЕННОГО проекта пуша — весь остальной код
  // ниже (выбор проекта, предпросмотр аудитории, авто-выбор) написан в терминах "projects" и
  // работает без дополнительных ветвлений, просто видит список из одного элемента.
  const projects = useMemo(
    () => (isEditMode ? allowedProjects.filter((p) => p.id === editProjectId) : allowedProjects),
    [allowedProjects, isEditMode, editProjectId],
  );

  const [selectedIds, setSelectedIds] = useState<string[]>(initialProjectIds);
  useEffect(() => {
    if (initialProjectIds.length) setSelectedIds((prev) => Array.from(new Set([...prev, ...initialProjectIds])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Автовыбор первого проекта, если ничего не предвыбрано (см. комментарий выше) — без этого
  // редактор контента (наверху страницы) не мог бы загружать медиа: PushContentStep требует
  // projectId для авторизации загрузки, а выбор проектов теперь ниже по странице.
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

  // Предзаполнение формы существующим пушем (запрос пользователя 2026-08-05) — один разовый
  // эффект (prefilledRef), а не постоянная синхронизация: после первого заполнения пользователь
  // редактирует локальное состояние формы как обычно, повторный рефетч (например, после фокуса
  // окна) не должен затирать несохранённые правки.
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

  // Предпросмотр аудитории для ВСЕХ доступных проектов сразу (запрос пользователя 2026-08-04:
  // "прямо в этой выборке пиши сколько где доступно") — не только для отмеченных, иначе строка
  // проекта не могла бы показать число до того, как его отметили. Зависит только от filter, не
  // от selectedIds — переключение чекбоксов больше не бьёт по сети, только смена фильтра.
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
  // Итог для карточки "Фильтры получателей" — сумма по уже посчитанным строкам ТОЛЬКО отмеченных
  // проектов, без отдельного запроса (тот же ответ preview-audience уже содержит разбивку по всем).
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
    // PushContentStep для переключения видео↔кружок без повторной загрузки, см. его
    // комментарий) — бэкенд его не знает, а глобальный ValidationPipe с forbidNonWhitelisted
    // отклонил бы весь запрос при лишнем поле в messageMedia.
    messageMedia: content.media.length ? content.media.map(({ url, type }) => ({ url, type })) : undefined,
    buttons: content.buttons.filter((b) => b.text && b.url).length ? content.buttons.filter((b) => b.text && b.url) : undefined,
    filter: buildFilterPayload(filter),
    sendNow: sendMode === 'now',
    scheduledAt: sendMode === 'scheduled' && dateStr && timeStr ? zonedTimeToUtcIso(dateStr, timeStr, timezone) : undefined,
  });

  // PATCH не отправляет рассылку (в отличие от POST /pushes с sendNow) — редактирование только
  // сохраняет контент/аудиторию/расписание. Здесь "sendMode==='now'" переиспользует ту же галочку,
  // что и в создании, но означает другое: "без расписания" → scheduledAt:null, что
  // PushesService.update трактует как явный откат в DRAFT (см. бэкенд-комментарий там же).
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
      <h1 className="text-2xl font-bold">{isEditMode ? 'Редактирование рассылки' : 'Новая рассылка'}</h1>

      {projectsLoading ? null : projects.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Нет проектов с правом на создание рассылок</CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Контент</CardTitle>
            </CardHeader>
            <CardContent>
              <PushContentStep projectId={contentProjectId} value={content} onChange={setContent} onUploadingChange={setIsUploading} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Проект</CardTitle>
                </CardHeader>
                <CardContent className={isEditMode ? undefined : 'p-0'}>
                  {/* Режим редактирования: проект зафиксирован (Push принадлежит ровно одному
                      проекту в схеме) — показываем как статичную строку, а не чекбокс-список. */}
                  {isEditMode ? (
                    <div className="flex items-center gap-3 px-1 py-1">
                      <ChannelAvatar channelId={projects[0]?.channel?.id ?? ''} hasAvatar={hasChannelAvatar(projects[0]?.channel)} fallbackLetter={projects[0]?.name ?? ''} />
                      <span className="font-medium">{projects[0]?.name}</span>
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto divide-y">
                      {projects.map((p) => {
                        const stat = audienceByProject.get(p.id);
                        return (
                          <label
                            key={p.id}
                            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                          >
                            <Checkbox checked={selectedIds.includes(p.id)} onCheckedChange={() => toggleProject(p.id)} />
                            <ChannelAvatar channelId={p.channel?.id ?? ''} hasAvatar={hasChannelAvatar(p.channel)} fallbackLetter={p.name} />
                            <span className="flex-1 font-medium truncate">{p.name}</span>
                            <span className="text-sm text-muted-foreground shrink-0">
                              Доступно: {stat ? stat.audienceReachable : isCalculating ? '…' : '—'}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <CardTitle className="text-base">Расписание</CardTitle>
                    {/* Чекбокс рядом вместо переключателя-таба (баг-репорт пользователя
                        2026-08-05: "кнопка отправить уходит вниз когда открывается календарь") —
                        календарь всегда на месте (просто дизэйблится), высота блока не меняется
                        при переключении. */}
                    <label className="flex items-center gap-2 text-sm cursor-pointer font-normal">
                      <Checkbox checked={sendMode === 'now'} onCheckedChange={() => setSendMode(sendMode === 'now' ? 'scheduled' : 'now')} />
                      {/* В режиме редактирования PATCH ничего не отправляет — эта же галочка
                          означает "без расписания" (откат в DRAFT), а не немедленную отправку. */}
                      {isEditMode ? 'Без расписания' : 'Отправить сейчас'}
                    </label>
                  </div>
                </CardHeader>
                <CardContent className={`space-y-3 ${sendMode === 'now' ? 'opacity-50 pointer-events-none' : ''}`}>
                  {/* По первому отмеченному проекту, даже если отмечено несколько (баг-репорт
                      пользователя 2026-08-05: "когда выбираю проект, календарь из расписания
                      теряется" — раньше требовалось ровно 1 выбранный проект, календарь исчезал
                      при выборе второго). Календарь всё равно про один проект по своей природе —
                      просто теперь не про "любой один", а конкретно про первый отмеченный. */}
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
                    <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} className="w-40" />
                    <Input type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} className="w-32" />
                  </div>
                  <TimezoneInput
                    value={timezone}
                    onChange={setTimezone}
                    id="push-timezone"
                    label="Часовой пояс отправки"
                    hint="По умолчанию — ваш текущий пояс. Дата/время выше считаются в нём."
                  />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Фильтры получателей</CardTitle>
              </CardHeader>
              <CardContent>
                <PushAudienceStep
                  value={filter}
                  onChange={setFilter}
                  audienceTotal={audience ? selectedTotal.audienceTotal : null}
                  audienceReachable={audience ? selectedTotal.audienceReachable : null}
                  isCalculating={isCalculating}
                />
              </CardContent>
            </Card>
          </div>

          {submit.isError && (
            <p className="text-sm text-red-500">{isEditMode ? 'Не удалось сохранить изменения' : 'Не удалось создать рассылку'}</p>
          )}

          <Button disabled={!canSubmit || submit.isPending} onClick={() => submit.mutate()}>
            {isEditMode ? (submit.isPending ? 'Сохраняем...' : 'Сохранить изменения') : submit.isPending ? 'Создаём...' : 'Создать рассылку'}
          </Button>
        </>
      )}
    </div>
  );
}
