'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Eye, Globe, Link2, SplitSquareHorizontal, Trash2, Upload, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { buildAutoPath, cn } from '@/lib/utils';
import {
  DomainOption,
  LandingItem,
  NO_DOMAIN,
  STATUS_LABEL,
  TYPE_LABEL,
  TemplateInfo,
  attachGroupToDomain,
  attachmentUrl,
  channelHandle,
  channelTitle,
  findGroupAttachment,
  hasChannelAvatar,
  findLandingAttachment,
  primaryChannel,
} from '@/lib/landings';
import { ChannelAvatar } from '@/components/channel-avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Выпадающий список доменов, общий для диалогов создания лендинга и привязки домена к
// существующему — везде одна и та же семантика "без домена" / выбор из уже зарегистрированных.
export function DomainSelect({
  value,
  onChange,
  domains,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  domains: DomainOption[] | undefined;
  id?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_DOMAIN}>Без домена</SelectItem>
        {domains?.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            {d.domain}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function LandingCard({
  landing,
  domains,
  showProject,
  onPreview,
  onManageDomain,
  onGetLink,
  onReupload,
  onManageAbTest,
  onPublish,
  onUnpublish,
  onDelete,
  isPublishPending,
  isDeletePending,
  canDelete = true,
  selectable,
  selected,
  onToggleSelect,
  abTestGroupLabel,
  hideStatusBadge,
  statusDotClassName,
  hideChannelDetails,
  statsHrefOverride,
  containerClassName,
}: {
  landing: LandingItem;
  domains: DomainOption[] | undefined;
  showProject: boolean;
  onPreview: () => void;
  onManageDomain: () => void;
  onGetLink: () => void;
  onReupload?: () => void;
  // Опционально (запрос пользователя 2026-07-30, только Studio: "убери кнопку для сравнения из
  // карточки" — судя по всему про эту кнопку, она рисуется тем же SplitSquareHorizontal-значком,
  // что и "Сравнить лендинги" в шапке страницы) — когда не передан, кнопка вообще не рендерится,
  // тот же паттерн, что уже был у onReupload. Управление A/B-тестом для конкретного лендинга
  // по-прежнему доступно через режим "Сравнить" (шапка страницы) или карточку самой A/B-группы —
  // эта кнопка была лишь одним из нескольких путей, не единственным.
  onManageAbTest?: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
  isPublishPending: boolean;
  isDeletePending: boolean;
  // Опционально (запрос пользователя 2026-07-30, только для Studio-версии страницы лендингов:
  // "подметь по цвету карточки активен лэндинг или в драфте и убери надпись") — по умолчанию
  // не заданы, поведение остальных потребителей (классическая страница, компанейская /landings)
  // не меняется ни на пиксель. hideStatusBadge прячет текстовый Badge статуса, statusDotClassName
  // рисует вместо него цветную точку рядом с названием — цвет решает вызывающая сторона
  // (LandingCard остаётся design-agnostic). Прошли 3 захода в один день: border-l-4 (не
  // понравился — не сочетался с rounded-xl), затем целиковая цветная ring-рамка (тоже отменили),
  // вернулись к точке, только крупнее исходной.
  hideStatusBadge?: boolean;
  statusDotClassName?: string;
  // Опционально, только Studio (запрос пользователя 2026-07-30, 3 захода в один день):
  // 1) "можешь убрать название бота и количество подписчиков в канале" — освободить место под
  //    бейджи редиректа/клоакинга; 2) "сам канал надо было оставить" — первая версия прятала весь
  //    блок целиком, это было лишним; 3) "нужно оставить не название бота а название канала" —
  //    оказалось, что скрытое "название бота" было на самом деле @handle, откатившимся на
  //    tgBotUsername (у приватных каналов нет публичного tgChannelUsername) — итоговое поведение:
  //    название канала (title) видно ВСЕГДА (это надёжно настоящее название, не бот), а строка
  //    @handle+число подписчиков скрывается целиком, чтобы больше никогда не показать хендл бота
  //    вместо канала. Аватарка и заглушка "Канал не привязан" не затронуты.
  hideChannelDetails?: boolean;
  // Гранулярные права (запрос пользователя 2026-07-17) — скрывает кнопку удаления, если у
  // пользователя нет LANDINGS_DELETE. По умолчанию true — компонент используется в нескольких
  // местах, большинство вызовов не завязаны на права (например, публичная страница /landings
  // общего списка компании).
  canDelete?: boolean;
  // Режим выбора для группового A/B/n-теста (запрос пользователя 2026-07-15: "выбирать
  // лэндинги при нажатии на карточки") — переключается кнопкой "Сравнить" на странице
  // лендингов проекта. Пока selectable — клик по карточке отмечает/снимает выбор вместо
  // перехода на статистику, лендинги уже в другой группе недоступны для выбора.
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  // Подпись группы A/B-теста (запрос пользователя 2026-07-17: "не понятно кто с кем в группе")
  // — родитель считает её один раз для всех карточек (название группы либо имена участников),
  // см. computeAbTestGroupLabels в родительских страницах списка лендингов.
  abTestGroupLabel?: string | null;
  // Опционально, только Studio (запрос пользователя 2026-07-30: "добей остальные оставшиеся
  // страницы") — переопределяет адрес перехода по клику на карточку, чтобы Studio-версия
  // страницы лендингов вела на Studio-версию детальной страницы, а не на классическую. По
  // умолчанию не задан, поведение остальных потребителей (классическая страница проекта,
  // компанейская /landings) не меняется.
  statsHrefOverride?: string;
  // Studio (запрос пользователя 2026-08-03: "карточки лэндингов серые, надо под новый дизайн")
  // — обычный shadcn `<Card>` в тёмной теме красится в `--card` (плейсхолдер-токен, не
  // настоящий Studio-синий #171F2B, см. память dark_theme_rollout) — тот же паттерн, что уже
  // применён для LandingContentCard: когда передан containerClassName, рендерится обычный div
  // с этим классом вместо <Card>, поведение остальных потребителей не меняется.
  containerClassName?: string;
}) {
  const router = useRouter();
  const channel = primaryChannel(landing);
  const title = channel ? channelTitle(channel) : '';
  const handle = channel ? channelHandle(channel) : '';
  const attachment = findLandingAttachment(domains, landing.id);
  const statsHref = statsHrefOverride ?? `/projects/${landing.project.id}/landings/${landing.id}`;

  // Один запрос на всё дерево карточек — React Query дедуплицирует по ключу, даже если
  // на странице разом смонтированы десятки LandingCard (запрос пользователя 2026-07-15:
  // "в карточке лэндинга надо показывать какой у него шаблон").
  const { data: templates } = useQuery({
    queryKey: ['landing-templates'],
    queryFn: async () => (await api.get<TemplateInfo[]>('/landings/templates')).data,
    staleTime: 5 * 60 * 1000,
  });
  const templateName = landing.type === 'TEMPLATE' && landing.templateId ? templates?.find((t) => t.id === landing.templateId)?.name : null;
  // В режиме выбора лендинг, уже состоящий в какой-то группе, нельзя добавить в новую —
  // тот же порядок проверки, что и в AbTestGroupDialog (LandingsService.assertValidMembers).
  const selectDisabled = !!selectable && !!landing.abTestGroupId;

  const handleClick = () => (selectable ? !selectDisabled && onToggleSelect?.() : router.push(statsHref));
  const stateClassName = cn(
    'transition-colors',
    selectable && selectDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:ring-foreground/20',
    selectable && selected && 'ring-2 ring-primary',
  );

  const body = (
    <>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex items-center gap-2">
            {statusDotClassName && <span className={cn('w-3 h-3 rounded-full shrink-0', statusDotClassName)} title={STATUS_LABEL[landing.status]} />}
            <div className="min-w-0">
              <p className="font-medium truncate">{landing.name}</p>
              {showProject && <p className="text-xs text-muted-foreground truncate">{landing.project.name}</p>}
            </div>
          </div>
          {selectable ? (
            <Checkbox checked={!!selected} disabled={selectDisabled} className="shrink-0" />
          ) : (
            !hideStatusBadge && (
              // DRAFT — destructive (красный), не secondary (запрос пользователя 2026-08-20:
              // "не активный лэндинг подмечай не серым кружком а красным" — тот же принцип, что
              // применён к цветной точке Studio, здесь эквивалент — цвет бейджа). ARCHIVED
              // остаётся secondary — это осознанно другое, "снятое с публикации" состояние, не
              // "забыли включить".
              <Badge
                variant={landing.status === 'PUBLISHED' ? 'default' : landing.status === 'DRAFT' ? 'destructive' : 'secondary'}
                className="shrink-0"
              >
                {STATUS_LABEL[landing.status]}
              </Badge>
            )
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline">{TYPE_LABEL[landing.type]}</Badge>
          {templateName && <Badge variant="outline">{templateName}</Badge>}
          {landing.abTestGroupId && <Badge variant="outline">{abTestGroupLabel || 'A/B-тест'}</Badge>}
          {/* Запрос пользователя 2026-07-30: "укажи в карточке лэндинга если ли там редирект и
              клоакинг" — раньше эти два реальных, часто настраиваемых поведения лендинга нигде
              не были видны в списке, узнать можно было только зайдя в редактирование. */}
          {landing.autoRedirect && (
            <Badge variant="outline" title="Редирект в Telegram сразу при заходе, без клика по кнопке">
              Авторедирект
            </Badge>
          )}
          {landing.cloakingEnabled && (
            <Badge variant="outline" title="Показывается только посетителям из разрешённых стран, остальным — подмена">
              Клоакинг
            </Badge>
          )}
        </div>

        {channel ? (
          <div className="flex items-center gap-2 border rounded-md p-2">
            <ChannelAvatar channelId={channel.id} hasAvatar={hasChannelAvatar(channel)} fallbackLetter={title || handle || 'T'} />
            <div className="min-w-0 text-sm">
              {/* hideChannelDetails, 3-е уточнение (запрос пользователя 2026-07-30: "нужно
                  оставить не название бота а название канала") — title здесь ВСЕГДА реальное
                  название канала (channelTitle отдаёт tgChannelTitle с приоритетом, откат на имя
                  бота — только для проектов без своего канала вообще), так что название теперь
                  видно всегда. "Именем бота" на самом деле оказался @handle: у приватных каналов
                  (PRIVATE_CHANNEL_REQUEST) нет публичного tgChannelUsername, и handle откатывался
                  на @tgBotUsername — то есть именно хендл бота показывался вместо названия
                  канала. Поэтому теперь скрывается вся строка handle+подписчики, а не только
                  подписчики — название остаётся единственным видимым идентификатором канала. */}
              {title && <p className="font-medium truncate">{title}</p>}
              {!hideChannelDetails && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  {handle && (
                    <a
                      href={`https://t.me/${handle.replace(/^@/, '')}`}
                      target="_blank"
                      rel="noopener"
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline truncate"
                    >
                      @{handle.replace(/^@/, '')}
                    </a>
                  )}
                  {channel.tgChannelMembersCount != null && (
                    <span className="inline-flex items-center gap-0.5 shrink-0">
                      <Users className="w-3 h-3" /> {channel.tgChannelMembersCount}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Канал не привязан к проекту</p>
        )}

        {attachment ? (
          <a
            href={attachmentUrl(attachment)}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
            className="block text-xs font-mono text-muted-foreground hover:underline truncate"
          >
            {attachment.domain}
            {attachment.path === '/' ? '' : attachment.path}
          </a>
        ) : (
          <p className="text-xs text-muted-foreground">Домен не привязан</p>
        )}

        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="w-3.5 h-3.5" />
          {landing._count.clients} {landing._count.clients === 1 ? 'подписчик' : 'подписчиков'}
        </div>

        {/* Автор (запрос пользователя 2026-08-03: "в лэндинге укажи кто его создал") — null у
            лендингов, чей автор не резолвится (см. LandingItem.createdBy). */}
        {landing.createdBy && (
          <p className="text-xs text-muted-foreground truncate">
            Создал: {landing.createdBy.firstName} {landing.createdBy.lastName ?? ''}
          </p>
        )}

        {/* Клик по карточке ведёт на страницу статистики лендинга — действия ниже не должны
            всплывать до Card.onClick, иначе кнопка "Удалить" и остальные тоже открывали бы её.
            В режиме выбора (selectable) сами действия не имеют смысла — клики по карточке
            должны только отмечать/снимать выбор. */}
        {/* flex-wrap (баг-репорт пользователя 2026-07-30: "некоторые иконки уходит за рамки
            карточки") — без него более длинная надпись "Снять с публикации" (в отличие от
            короткого "Опубликовать") требовала больше места по горизонтали, чем умещалось в
            карточке — ряд не переносился, а раздвигал карточку внутри grid-ячейки (min-content
            сетки по умолчанию), визуально вылезая за пределы соседних карточек той же ширины. */}
        <div
          className={cn('flex items-center justify-end flex-wrap gap-1.5 pt-1 border-t', selectable && 'pointer-events-none opacity-40')}
          onClick={(e) => e.stopPropagation()}
        >
          <Button size="sm" variant="ghost" onClick={onPreview} title="Предпросмотр">
            <Eye className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onManageDomain} title="Домен">
            <Globe className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onGetLink} title="Получить ссылку">
            <Link2 className="w-4 h-4" />
          </Button>
          {onManageAbTest && (
            <Button size="sm" variant="ghost" onClick={onManageAbTest} title="A/B-тест">
              <SplitSquareHorizontal className="w-4 h-4" />
            </Button>
          )}
          {landing.type === 'CUSTOM' && onReupload && (
            <Button size="sm" variant="ghost" onClick={onReupload} title="Перезалить ZIP">
              <Upload className="w-4 h-4" />
            </Button>
          )}
          {/* Короткие подписи (баг-репорт пользователя 2026-07-30: "кнопки уходят вниз... такого
              не должно быть") — "Снять с публикации" было заметно длиннее "Опубликовать" и
              провоцировало перенос ряда на 2-ю строку внутри карточки чаще остальных кнопок. */}
          {landing.status === 'PUBLISHED' ? (
            <Button size="sm" variant="outline" onClick={onUnpublish} disabled={isPublishPending}>
              Снять
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onPublish} disabled={isPublishPending}>
              Опубликовать
            </Button>
          )}
          {canDelete && (
            <Button size="sm" variant="ghost" onClick={onDelete} disabled={isDeletePending}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
    </>
  );

  if (containerClassName) {
    return (
      <div onClick={handleClick} className={cn(containerClassName, stateClassName)}>
        <div className="p-4 space-y-3">{body}</div>
      </div>
    );
  }

  return (
    <Card onClick={handleClick} className={stateClassName}>
      <CardContent className="p-4 space-y-3">{body}</CardContent>
    </Card>
  );
}

// Смена/снятие привязки домена у уже существующего лендинга. landing.project.id уже несёт
// свой projectId, поэтому диалог работает одинаково и на странице одного проекта, и на общей
// странице всех лендингов (где у каждой карточки свой проект).
// Минимальная форма вместо полного LandingItem — диалог используется и там, где под рукой
// полный объект (карточка лендинга), и там, где есть только id/name/projectId (страница
// статистики лендинга, см. GetLinkDialog — тот же принцип).
export interface LandingDomainRef {
  id: string;
  name: string;
  project: { id: string };
}

export function LandingDomainDialog({
  landing,
  domains,
  onClose,
  onSaved,
}: {
  landing: LandingDomainRef | null;
  domains: DomainOption[] | undefined;
  onClose: () => void;
  // Доп. колбэк после успешного сохранения (помимо onClose) — например, инвалидировать
  // серверный /landings/:id/stats на странице статистики лендинга, у которой attachment
  // приходит отдельным запросом, не пересчитывается из ['domains'] на клиенте.
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState(NO_DOMAIN);
  const [error, setError] = useState('');

  const current = landing ? findLandingAttachment(domains, landing.id) : null;

  useEffect(() => {
    setSelection(current?.domainId ?? NO_DOMAIN);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landing?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!landing) return;

      const attachments = (domains ?? []).flatMap((d) =>
        d.paths.filter((p) => p.landingId === landing.id).map((p) => ({ domainId: d.id, pathId: p.id })),
      );
      for (const a of attachments) {
        if (selection === NO_DOMAIN || a.domainId !== selection) {
          await api.delete(`/domains/${a.domainId}/paths/${a.pathId}`);
        }
      }

      if (selection !== NO_DOMAIN) {
        const domain = domains?.find((d) => d.id === selection);
        if (domain) {
          const path = buildAutoPath(
            landing.project.id,
            landing.id,
            domain.paths.filter((p) => p.landingId !== landing.id).map((p) => p.path),
          );
          await api.post(`/domains/${selection}/paths`, { path, landingId: landing.id });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      onSaved?.();
      onClose();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить домен'),
  });

  if (!landing) return null;

  return (
    <Dialog open={!!landing} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Домен для «{landing.name}»</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {current && (
            <p className="text-sm text-muted-foreground">
              Сейчас:{' '}
              <a href={attachmentUrl(current)} target="_blank" rel="noopener" className="font-mono hover:underline">
                {current.domain}
                {current.path === '/' ? '' : current.path}
              </a>
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="landing-domain-edit">Домен</Label>
            <DomainSelect id="landing-domain-edit" value={selection} onChange={setSelection} domains={domains} />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Сохраняем...' : 'Сохранить'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// A/B/n-тестирование (Фаза 3.2, запрос пользователя 2026-07-15, расширено тем же днём с пары
// до произвольного числа вариантов) — баер объединяет несколько уже существующих лендингов
// одного проекта в группу с индивидуальными % трафика на каждый, сплит делается на бэкенде
// (LandingRendererService.resolveAbTestVariant), без cookie/стикости — принятый компромисс.
// Не привязан к одному "своему" лендингу как раньше — состояние группы целиком: groupId===null
// значит "создаём новую" (preselectedIds — с чего начать отметки, из клика по карточкам или
// из иконки одного лендинга), иначе редактируем/останавливаем существующую.
export interface AbTestDialogTarget {
  // null — компания-wide "Создать тест" без фиксированного проекта (запрос пользователя
  // 2026-08-20: "на странице всех лендингов... если в группах нет групп, пусть будет кнопка
  // создать") — тот же приём, что уже есть у CreateLandingFromTemplateDialog (fixedProjectId
  // необязателен, сам диалог тогда показывает выбор проекта). На проектных страницах всегда
  // передаётся реальный projectId, выбор не показывается.
  projectId: string | null;
  groupId: string | null;
  preselectedIds: string[];
}

export function AbTestGroupDialog({
  target,
  domains,
  onClose,
  onSaved,
}: {
  target: AbTestDialogTarget | null;
  // Для привязки домена/пути прямо к группе (запрос пользователя 2026-07-17) — тот же список,
  // что уже грузится для LandingDomainDialog на всех трёх страницах, где открывается этот диалог.
  domains: DomainOption[] | undefined;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [domainSelection, setDomainSelection] = useState(NO_DOMAIN);
  const [error, setError] = useState('');
  // Выбор проекта внутри диалога — только когда target.projectId===null (company-wide создание).
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const effectiveProjectId = target?.projectId || selectedProjectId;

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<{ id: string; name: string }[]>('/projects')).data,
    enabled: !!target && !target.projectId,
  });

  const { data: projectLandings } = useQuery({
    queryKey: ['landings', effectiveProjectId, 'ab-options'],
    queryFn: async () => (await api.get<LandingItem[]>(`/projects/${effectiveProjectId}/landings`)).data,
    enabled: !!effectiveProjectId,
  });

  const currentGroupAttachment = target?.groupId ? findGroupAttachment(domains, target.groupId) : null;

  // Равномерно распределяет 100% между переданными id (последнему достаётся остаток от
  // деления) — используется и при инициализации, и при каждом клике по чекбоксу.
  const equalize = (ids: string[]): Record<string, number> => {
    const equal = Math.floor(100 / Math.max(ids.length, 1));
    const remainder = 100 - equal * ids.length;
    const next: Record<string, number> = {};
    ids.forEach((id, i) => {
      next[id] = equal + (i === ids.length - 1 ? remainder : 0);
    });
    return next;
  };

  // Сброс выбора проекта при каждом новом открытии диалога — иначе company-wide "Создать тест"
  // после закрытия сохранял бы ранее выбранный проект.
  useEffect(() => {
    setSelectedProjectId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!target]);

  useEffect(() => {
    if (!target || !effectiveProjectId || !projectLandings) return;
    const members = target.groupId ? projectLandings.filter((l) => l.abTestGroupId === target.groupId) : [];
    const initialIds = target.groupId ? members.map((l) => l.id) : target.preselectedIds;
    setCheckedIds(new Set(initialIds));
    // Редактирование существующего теста — реальные сохранённые проценты (Landing.abTestWeight),
    // не equalize() (тот только для НОВОГО набора чекбоксов при создании) — иначе застывшая
    // read-only карточка участников показывала бы неверные, всегда поровну разделённые проценты
    // вместо фактических (найдено при живой проверке блокировки состава 2026-08-20).
    setWeights(target.groupId ? Object.fromEntries(members.map((l) => [l.id, l.abTestWeight ?? 0])) : equalize(initialIds));
    setName(members.find((l) => l.abTestGroup?.name)?.abTestGroup?.name ?? '');
    setDomainSelection(currentGroupAttachment?.domainId ?? NO_DOMAIN);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.groupId, effectiveProjectId, target?.preselectedIds.join(','), !!projectLandings]);

  const toggle = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setWeights(equalize(Array.from(next)));
      return next;
    });
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['landings'] });
    queryClient.invalidateQueries({ queryKey: ['domains'] });
  };

  const save = useMutation({
    mutationFn: async (members: { landingId: string; weight: number }[]) => {
      if (!target || !effectiveProjectId) return;
      let groupId = target.groupId;
      // Редактирование существующего теста — только название (запрос пользователя 2026-08-20:
      // "после создания группы... уже нельзя будет их менять" — состав/веса фиксируются раз и
      // навсегда при создании, см. UpdateAbTestGroupDto на бэкенде).
      if (groupId) await api.patch(`/ab-test-groups/${groupId}`, { name: name || undefined });
      else {
        const res = await api.post<{ id: string }>(`/projects/${effectiveProjectId}/ab-test-groups`, { name: name || undefined, members });
        groupId = res.data.id;
      }

      // Домен/путь для самой группы (запрос пользователя 2026-07-17) — тот же attach/detach-
      // паттерн, что и в LandingDomainDialog, просто ключ — abTestGroupId, не landingId.
      const attachments = (domains ?? []).flatMap((d) =>
        d.paths.filter((p) => p.abTestGroupId === groupId).map((p) => ({ domainId: d.id, pathId: p.id })),
      );
      for (const a of attachments) {
        if (domainSelection === NO_DOMAIN || a.domainId !== domainSelection) {
          await api.delete(`/domains/${a.domainId}/paths/${a.pathId}`);
        }
      }
      if (domainSelection !== NO_DOMAIN && groupId) {
        await attachGroupToDomain(effectiveProjectId, groupId, domainSelection, domains);
      }
    },
    onSuccess: () => {
      invalidate();
      onSaved?.();
      onClose();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить'),
  });

  const stop = useMutation({
    mutationFn: async () => {
      if (target?.groupId) await api.delete(`/ab-test-groups/${target.groupId}`);
    },
    onSuccess: () => {
      invalidate();
      onSaved?.();
      onClose();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось остановить тест'),
  });

  const trySave = () => {
    // Редактирование — состав уже зафиксирован, проверять/отправлять members не нужно.
    if (target?.groupId) {
      setError('');
      save.mutate([]);
      return;
    }
    const members = Array.from(checkedIds).map((id) => ({ landingId: id, weight: weights[id] ?? 0 }));
    if (members.length < 2) {
      setError('Выберите минимум 2 лендинга');
      return;
    }
    if (members.reduce((sum, m) => sum + m.weight, 0) !== 100) {
      setError('Сумма процентов должна быть равна 100');
      return;
    }
    setError('');
    save.mutate(members);
  };

  if (!target) return null;

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{target.groupId ? 'A/B/n-тест' : 'Новый A/B/n-тест'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Выбор проекта — только при создании без фиксированного (запрос пользователя
              2026-08-20, company-wide "Создать тест"); на проектных страницах target.projectId
              уже задан, этот блок не показывается. */}
          {!target.projectId && (
            <div className="space-y-1.5">
              <Label htmlFor="ab-group-project">Проект</Label>
              <Select value={selectedProjectId || undefined} onValueChange={(v) => setSelectedProjectId(v ?? '')}>
                <SelectTrigger id="ab-group-project">
                  <SelectValue placeholder="Выберите проект">
                    {(v: string) => (projects ?? []).find((p) => p.id === v)?.name ?? v}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="w-auto min-w-(--anchor-width)">
                  {(projects ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ab-group-name">Название теста (необязательно)</Label>
            <Input id="ab-group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, «Летняя акция»" />
          </div>

          {!effectiveProjectId ? (
            <p className="text-sm text-muted-foreground">Сначала выберите проект.</p>
          ) : !projectLandings ? (
            <p className="text-sm text-muted-foreground">Загрузка...</p>
          ) : target.groupId ? (
            // Редактирование существующего теста (запрос пользователя 2026-08-20: "после
            // создания группы... уже нельзя будет их менять, так как статистика будет
            // неверной") — состав/веса только для просмотра, менять нельзя.
            <div className="space-y-1.5">
              <Label>Участники теста</Label>
              <div className="max-h-80 overflow-y-auto space-y-1 rounded-md border p-2">
                {Array.from(checkedIds).map((id) => (
                  <div key={id} className="flex items-center justify-between gap-2 py-0.5 text-sm">
                    <span className="truncate">{projectLandings.find((pl) => pl.id === id)?.name ?? id}</span>
                    <span className="text-muted-foreground shrink-0">{weights[id] ?? 0}%</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Состав и проценты нельзя изменить после запуска — иначе сравнение вариантов станет нечестным.
                Чтобы изменить состав, завершите этот тест и запустите новый.
              </p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-0.5">
              {projectLandings.map((l) => {
                const checked = checkedIds.has(l.id);
                // Эта ветка рендерится только при создании нового теста (target.groupId ===
                // null, см. ветку выше) — исключение "уже состоит в СВОЕЙ группе" тут не нужно.
                const disabled = !!l.abTestGroupId;
                return (
                  <div key={l.id} className="flex items-center gap-2 py-1">
                    <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => !disabled && toggle(l.id)} />
                    <span className={cn('flex-1 truncate text-sm', disabled && 'text-muted-foreground')}>
                      {l.name}
                      {disabled && <span className="ml-1 text-xs">(уже в другом тесте)</span>}
                    </span>
                    {checked && (
                      <>
                        <Input
                          type="number"
                          min={1}
                          max={99}
                          value={weights[l.id] ?? 0}
                          onChange={(e) => setWeights((w) => ({ ...w, [l.id]: Number(e.target.value) }))}
                          className="w-16 h-8"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-1.5 pt-1 border-t">
            <Label htmlFor="ab-group-domain">Домен для теста целиком</Label>
            {currentGroupAttachment && (
              <p className="text-sm text-muted-foreground">
                Сейчас:{' '}
                <a href={attachmentUrl(currentGroupAttachment)} target="_blank" rel="noopener" className="font-mono hover:underline">
                  {currentGroupAttachment.domain}
                  {currentGroupAttachment.path === '/' ? '' : currentGroupAttachment.path}
                </a>
              </p>
            )}
            <DomainSelect id="ab-group-domain" value={domainSelection} onChange={setDomainSelection} domains={domains} />
            <p className="text-xs text-muted-foreground">
              Заход по этой ссылке распределяется между вариантами по проценту выше. Для ссылки на конкретный вариант
              отдельно — привяжите домен к самому лендингу (иконка домена на его карточке).
            </p>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={trySave} disabled={save.isPending || !effectiveProjectId}>
              {save.isPending ? 'Сохраняем...' : target.groupId ? 'Сохранить' : 'Запустить тест'}
            </Button>
            {target.groupId && (
              <Button variant="destructive" onClick={() => stop.mutate()} disabled={stop.isPending}>
                Остановить тест
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
