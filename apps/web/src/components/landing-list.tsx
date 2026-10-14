'use client';

// Табличный (списочный) вид лендингов — компактная альтернатива LandingCard/сетке карточек
// (запрос пользователя 2026-09-25: "сделай список, а не карточку, чтобы было более компактно для
// работы"). Пока используется ТОЛЬКО в Studio (обе версии — по проекту и общая по компании,
// classic-дерево пользователь просил не трогать: "classic можно вообще не трогать, эту версию уже
// не используют"). Построено на обычном shadcn <Table> — семантические токены (bg-card,
// text-foreground, border и т.п.) уже подхватывают Studio-палитру автоматически через единый CSS-
// override 2026-08-18 (.studio.dark), поэтому отдельная hand-rolled Studio-таблица не нужна, в
// отличие от более старого components/studio/clients-table.tsx.
//
// Все действия (предпросмотр/домен/ссылка/A-B/перезалить/подключение/публикация/удаление)
// перенесены из футера карточки в выпадающее меню (⋮) — их стало слишком много для одной строки
// таблицы. Второстепенные детали карточки (канал, привязанный домен, автор) в список не попали —
// компактность была явной целью запроса, эти детали остаются на детальной странице лендинга,
// куда по-прежнему ведёт клик по строке.
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Copy, Eye, Globe, LayoutGrid, Link2, List, MoreHorizontal, Pencil, Shield, SplitSquareHorizontal, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  LandingAttachment,
  LandingItem,
  LandingStatus,
  STATUS_LABEL,
  TYPE_LABEL,
  TemplateInfo,
  attachmentUrl,
  hasChannelAvatar,
  primaryChannel,
} from '@/lib/landings';
import { ChannelAvatar } from '@/components/channel-avatar';
import { LandingsView, useUiStore } from '@/store/ui.store';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { buttonVariants } from '@/components/ui/button';

// Тот же цвет статуса, что уже был на Studio-карточках (2026-07-30, красный для DRAFT —
// 2026-08-20) — просто больше не дублируется в двух page.tsx по отдельности.
const STATUS_DOT_CLASS: Record<LandingStatus, string> = {
  PUBLISHED: 'bg-[#1F7A6C] dark:bg-[#6FCBBA]',
  DRAFT: 'bg-red-500 dark:bg-red-400',
  ARCHIVED: 'bg-[#6B3E63] dark:bg-[#D19BC4]',
};

// Пилюля "Фильтрация" (переименованный запросом пользователя "Клоакинг") — сама она же и есть
// кнопка настройки: зелёная/кликабельная ведёт на страницу правил клоакинга лендинга, красная —
// туда же, просто сигналит "выключено" (запрос: "красная — выключен клоакинг, зелёная — включен,
// и уже при нажатии пользователь попадает на настройку").
function FilteringPill({ landing }: { landing: LandingItem }) {
  return (
    <Link
      href={`/projects/${landing.project.id}/landings/${landing.id}/cloaking`}
      onClick={(e) => e.stopPropagation()}
      title="Настройка фильтрации (клоакинга)"
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-lg whitespace-nowrap transition-opacity hover:opacity-80',
        landing.cloakingEnabled
          ? 'bg-[#1F7A6C]/10 dark:bg-[#6FCBBA]/10 text-[#1F7A6C] dark:text-[#6FCBBA]'
          : 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400',
      )}
    >
      <Shield className="w-3 h-3" />
      {landing.cloakingEnabled ? 'Вкл' : 'Выкл'}
    </Link>
  );
}

// Общий набор действий над лендингом — одинаковый для строки списка и для карточки.
export interface LandingActionProps {
  landing: LandingItem;
  onPreview: () => void;
  onManageDomain: () => void;
  onGetLink: () => void;
  onReupload?: () => void;
  onManageExternal?: () => void;
  onManageAbTest?: () => void;
  onDuplicate: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
  isPublishPending: boolean;
  isDuplicatePending?: boolean;
  isDeletePending: boolean;
  canDelete?: boolean;
}

function LandingActionsMenu({
  landing,
  onPreview,
  onManageDomain,
  onGetLink,
  onReupload,
  onManageExternal,
  onManageAbTest,
  onDuplicate,
  onPublish,
  onUnpublish,
  onDelete,
  isPublishPending,
  isDuplicatePending,
  isDeletePending,
  canDelete = true,
}: LandingActionProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-8 w-8')}
      >
        <MoreHorizontal className="w-4 h-4" />
      </DropdownMenuTrigger>
      {/* Баг-репорт пользователя 2026-09-25: "окно с опциями маленькое, текст не помещается" —
          по умолчанию ширина меню равна w-(--anchor-width) (ширине кнопки-триггера — тут это
          крошечная иконка ⋮), а не ширине самих пунктов; тот же класс бага, что уже чинился
          у SelectContent несколько раз в этом проекте. */}
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        <DropdownMenuItem onClick={onPreview}>
          <Eye className="w-4 h-4 mr-2" /> Предпросмотр
        </DropdownMenuItem>
        {landing.type !== 'EXTERNAL' && (
          <DropdownMenuItem onClick={onManageDomain}>
            <Globe className="w-4 h-4 mr-2" /> Домен
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onGetLink}>
          <Link2 className="w-4 h-4 mr-2" /> Получить ссылку
        </DropdownMenuItem>
        {onManageAbTest && landing.type !== 'EXTERNAL' && (
          <DropdownMenuItem onClick={onManageAbTest}>
            <SplitSquareHorizontal className="w-4 h-4 mr-2" /> A/B-тест
          </DropdownMenuItem>
        )}
        {landing.type === 'CUSTOM' && onReupload && (
          <DropdownMenuItem onClick={onReupload}>
            <Upload className="w-4 h-4 mr-2" /> Перезалить ZIP
          </DropdownMenuItem>
        )}
        {landing.type === 'EXTERNAL' && onManageExternal && (
          <DropdownMenuItem onClick={onManageExternal}>
            <Globe className="w-4 h-4 mr-2" /> Подключение
          </DropdownMenuItem>
        )}
        {/* Копия лендинга (запрос клиентов 2026-10-02: "чтоб просто домен заменить для
            следующей ссылки") — копия создаётся БЕЗ привязки к домену, именно её клиент и
            должен привязать отдельно через "Домен" выше. */}
        <DropdownMenuItem onClick={onDuplicate} disabled={isDuplicatePending}>
          <Copy className="w-4 h-4 mr-2" /> Копировать
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {landing.status === 'PUBLISHED' ? (
          <DropdownMenuItem onClick={onUnpublish} disabled={isPublishPending}>
            Снять с публикации
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={onPublish} disabled={isPublishPending}>
            Опубликовать
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem onClick={onDelete} disabled={isDeletePending} variant="destructive">
            <Trash2 className="w-4 h-4 mr-2" /> Удалить
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useTemplateName(landing: LandingItem): string | null {
  // Один и тот же запрос на все строки/карточки — React Query дедуплицирует по ключу.
  const { data: templates } = useQuery({
    queryKey: ['landing-templates'],
    queryFn: async () => (await api.get<TemplateInfo[]>('/landings/templates')).data,
    staleTime: 5 * 60 * 1000,
  });
  return landing.type === 'TEMPLATE' && landing.templateId ? templates?.find((t) => t.id === landing.templateId)?.name ?? null : null;
}

export function LandingsTableHeader({ showProject, selectable }: { showProject: boolean; selectable?: boolean }) {
  return (
    <TableRow>
      {selectable && <TableHead className="w-10" />}
      <TableHead>Лендинг{showProject && ' / Проект'}</TableHead>
      <TableHead>Тип / Шаблон</TableHead>
      <TableHead className="text-right">Клиенты</TableHead>
      <TableHead className="text-right" title="Визиты, похожие на бота (пустой User-Agent, известный краулер или IP дата-центра) — эвристика, не платная база ботов">
        Ботов
      </TableHead>
      <TableHead
        className="text-right"
        title="Из них реально отфильтровано сработавшим правилом клоакинга (white-page/404/другой вариант) — 0, если фильтрация выключена или ни одно правило бота не задевает"
      >
        Отфильтровано
      </TableHead>
      <TableHead>Фильтрация</TableHead>
      <TableHead>Авторедирект</TableHead>
      <TableHead className="w-10" />
    </TableRow>
  );
}

export function LandingRow({
  landing,
  onPreview,
  onManageDomain,
  onGetLink,
  onReupload,
  onManageExternal,
  onManageAbTest,
  onDuplicate,
  onPublish,
  onUnpublish,
  onDelete,
  isPublishPending,
  isDuplicatePending,
  isDeletePending,
  canDelete = true,
  selectable,
  selected,
  onToggleSelect,
  abTestGroupLabel,
  showProject,
}: LandingActionProps & {
  showProject: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  abTestGroupLabel?: string | null;
}) {
  const router = useRouter();
  const statsHref = `/projects/${landing.project.id}/landings/${landing.id}`;

  const templateName = useTemplateName(landing);

  const selectDisabled = !!selectable && !!landing.abTestGroupId;
  const handleRowClick = () => (selectable ? !selectDisabled && onToggleSelect?.() : router.push(statsHref));

  return (
    <TableRow
      onClick={handleRowClick}
      className={cn('cursor-pointer', selectable && selectDisabled && 'opacity-50 cursor-not-allowed', selectable && selected && 'bg-muted')}
    >
      {selectable && (
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={!!selected} disabled={selectDisabled} onCheckedChange={() => !selectDisabled && onToggleSelect?.()} />
        </TableCell>
      )}
      <TableCell>
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', STATUS_DOT_CLASS[landing.status])} title={STATUS_LABEL[landing.status]} />
          <div className="min-w-0">
            <p className="font-medium truncate">{landing.name}</p>
            {showProject && <p className="text-xs text-muted-foreground truncate">{landing.project.name}</p>}
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm">{templateName ? `${TYPE_LABEL[landing.type]}: ${templateName}` : TYPE_LABEL[landing.type]}</span>
          {landing.abTestGroupId && (
            <span className="text-[11px] text-muted-foreground border rounded-lg px-1.5 py-0.5 whitespace-nowrap">
              {abTestGroupLabel || 'A/B-тест'}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">{landing._count.clients}</TableCell>
      <TableCell className="text-right whitespace-nowrap text-muted-foreground" title="Визиты, похожие на бота">
        {landing.botVisitsCount}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap text-muted-foreground" title="Реально отфильтровано (заблокировано клоакингом)">
        {landing.botsFilteredCount}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <FilteringPill landing={landing} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {landing.autoRedirect ? <span className="text-[#1F4E9C] dark:text-[#7BA9EE] text-sm">Вкл</span> : <span className="text-muted-foreground text-sm">—</span>}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <LandingActionsMenu
          landing={landing}
          onPreview={onPreview}
          onManageDomain={onManageDomain}
          onGetLink={onGetLink}
          onReupload={onReupload}
          onManageExternal={onManageExternal}
          onManageAbTest={onManageAbTest}
          onDuplicate={onDuplicate}
          onPublish={onPublish}
          onUnpublish={onUnpublish}
          onDelete={onDelete}
          isPublishPending={isPublishPending}
          isDuplicatePending={isDuplicatePending}
          isDeletePending={isDeletePending}
          canDelete={canDelete}
        />
      </TableCell>
    </TableRow>
  );
}

// ---- Карточки (запрос пользователя 2026-10-14) ----
// Альтернативный вид к списку выше, по образцу карточек конкурента, но в палитре Studio:
// проект/лендинг, автор, домен, канал, теги (шаблон, авторедирект, фильтрация), счётчики и
// действия. Выбор вида (список/карточки) сохраняется в persist-хранилище useUiStore.

// До монтирования отдаём 'list' — сервер рендерит дефолт, а сохранённый выбор из localStorage
// применяем только на клиенте, чтобы не ловить расхождение гидратации.
export function useLandingsView(): [LandingsView, (v: LandingsView) => void] {
  const stored = useUiStore((s) => s.landingsView);
  const setView = useUiStore((s) => s.setLandingsView);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return [mounted ? stored : 'list', setView];
}

export function LandingsViewToggle({ value, onChange }: { value: LandingsView; onChange: (v: LandingsView) => void }) {
  const item = (v: LandingsView, Icon: typeof List, label: string) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      title={label}
      aria-label={label}
      aria-pressed={value === v}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg transition-colors',
        value === v
          ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
          : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]',
      )}
    >
      <Icon className="w-4 h-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
  return (
    <div className="inline-flex rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-1 gap-0.5">
      {item('list', List, 'Список')}
      {item('cards', LayoutGrid, 'Карточки')}
    </div>
  );
}

export function LandingsCardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{children}</div>;
}

const MUTED = 'text-[#5F6B7A] dark:text-[#92A0AF]';
const INSET = 'rounded-lg bg-[#F3F5F8] dark:bg-white/[0.04] border border-[#E4E8EE] dark:border-white/[0.06]';
const TAG = 'inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-lg whitespace-nowrap';

export function LandingGridCard(
  props: LandingActionProps & {
    showProject: boolean;
    attachment: LandingAttachment | null;
    selectable?: boolean;
    selected?: boolean;
    onToggleSelect?: () => void;
    abTestGroupLabel?: string | null;
  },
) {
  const { landing, showProject, attachment, selectable, selected, onToggleSelect, abTestGroupLabel, canDelete = true } = props;
  const router = useRouter();
  const statsHref = `/projects/${landing.project.id}/landings/${landing.id}`;
  const templateName = useTemplateName(landing);
  const channel = primaryChannel(landing);
  const channelTitle = channel?.tgChannelTitle || channel?.tgBotFirstName || (channel?.type === 'WEBSITE' ? 'Сайт' : null);
  const channelHandle = channel?.tgChannelUsername || channel?.tgBotUsername || channel?.tgPersonalUsername;
  const author = landing.createdBy ? [landing.createdBy.firstName, landing.createdBy.lastName].filter(Boolean).join(' ') : null;

  const selectDisabled = !!selectable && !!landing.abTestGroupId;
  const handleClick = () => (selectable ? !selectDisabled && onToggleSelect?.() : router.push(statsHref));
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      onClick={handleClick}
      className={cn(
        'group flex flex-col gap-3 p-4 rounded-xl bg-white dark:bg-[#171F2B] border border-transparent dark:border-white/10 shadow-sm cursor-pointer transition-colors hover:border-[#1F4E9C]/30 dark:hover:border-[#7BA9EE]/30 min-w-0',
        selectable && selectDisabled && 'opacity-50 cursor-not-allowed',
        selectable && selected && 'border-[#1F4E9C] dark:border-[#7BA9EE]',
      )}
    >
      {/* Шапка: имя лендинга (или проект на общей странице) + статус */}
      <div className="flex items-start gap-2 min-w-0">
        {selectable && (
          <div onClick={stop} className="pt-0.5">
            <Checkbox checked={!!selected} disabled={selectDisabled} onCheckedChange={() => !selectDisabled && onToggleSelect?.()} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className={cn('text-xs truncate', MUTED)}>{showProject ? landing.project.name : templateName ? `${TYPE_LABEL[landing.type]}: ${templateName}` : TYPE_LABEL[landing.type]}</p>
          <p className="font-semibold text-[15px] leading-snug text-[#131A24] dark:text-[#E9EDF3] truncate" title={landing.name}>
            {landing.name}
          </p>
          {author && <p className={cn('text-xs truncate', MUTED)}>Создал: {author}</p>}
        </div>
        <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium shrink-0 mt-0.5', MUTED)}>
          <span className={cn('w-2 h-2 rounded-full', STATUS_DOT_CLASS[landing.status])} />
          {STATUS_LABEL[landing.status]}
        </span>
      </div>

      {/* Домен */}
      {landing.type === 'EXTERNAL' && landing.externalUrl ? (
        <a href={landing.externalUrl} target="_blank" rel="noreferrer" onClick={stop} className={cn(INSET, 'flex items-center gap-2 px-2.5 py-1.5 min-w-0 text-sm hover:opacity-80')}>
          <Globe className={cn('w-3.5 h-3.5 shrink-0', MUTED)} />
          <span className="truncate text-[#131A24] dark:text-[#E9EDF3]">{landing.externalUrl.replace(/^https?:\/\//, '')}</span>
        </a>
      ) : attachment ? (
        <a href={attachmentUrl(attachment)} target="_blank" rel="noreferrer" onClick={stop} className={cn(INSET, 'flex items-center gap-2 px-2.5 py-1.5 min-w-0 text-sm hover:opacity-80')}>
          <Globe className={cn('w-3.5 h-3.5 shrink-0', MUTED)} />
          <span className="truncate">
            <span className="font-medium text-[#131A24] dark:text-[#E9EDF3]">{attachment.domain}</span>
            {attachment.path !== '/' && <span className={MUTED}>{attachment.path}</span>}
          </span>
        </a>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            props.onManageDomain();
          }}
          className={cn(INSET, 'flex items-center gap-2 px-2.5 py-1.5 text-sm border-dashed hover:opacity-80', MUTED)}
        >
          <Globe className="w-3.5 h-3.5 shrink-0" />
          Без домена — привязать
        </button>
      )}

      {/* Канал проекта */}
      {channel && (
        <div className={cn(INSET, 'flex items-center gap-2.5 px-2.5 py-2 min-w-0')}>
          <div className="w-8 h-8 shrink-0 [&>*]:w-8 [&>*]:h-8">
            <ChannelAvatar channelId={channel.id} hasAvatar={hasChannelAvatar(channel)} fallbackLetter={(channelTitle || landing.project.name).charAt(0).toUpperCase()} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate text-[#131A24] dark:text-[#E9EDF3]">{channelTitle || landing.project.name}</p>
            <p className={cn('text-xs truncate', MUTED)}>{channelHandle ? `@${channelHandle}` : 'Канал'}</p>
          </div>
        </div>
      )}

      {/* Теги */}
      <div className="flex flex-wrap items-center gap-1.5" onClick={stop}>
        {showProject && (
          <span className={cn(TAG, 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]')}>
            {templateName ? templateName : TYPE_LABEL[landing.type]}
          </span>
        )}
        {landing.autoRedirect && <span className={cn(TAG, 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]')}>Авторедирект</span>}
        {landing.abTestGroupId && <span className={cn(TAG, 'border border-[#E4E8EE] dark:border-white/10', MUTED)}>{abTestGroupLabel || 'A/B-тест'}</span>}
        <FilteringPill landing={landing} />
      </div>

      {/* Счётчики */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ['Клиенты', landing._count.clients],
          ['Ботов', landing.botVisitsCount],
          ['Отфильтр.', landing.botsFilteredCount],
        ].map(([label, value]) => (
          <div key={label as string} className={cn(INSET, 'py-1.5')}>
            <p className="text-sm font-semibold tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{value}</p>
            <p className={cn('text-[11px]', MUTED)}>{label}</p>
          </div>
        ))}
      </div>

      {/* Действия */}
      <div className="flex items-center gap-1.5 mt-auto pt-1" onClick={stop}>
        <button
          type="button"
          onClick={props.onGetLink}
          className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-medium bg-[#1F4E9C] text-white hover:bg-[#1F4E9C]/90 dark:bg-[#7BA9EE] dark:text-[#0F1620] dark:hover:bg-[#7BA9EE]/90 transition-colors"
        >
          <Link2 className="w-4 h-4" /> Получить ссылку
        </button>
        <Link href={statsHref} title="Открыть лендинг" className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-9 w-9')}>
          <Pencil className="w-4 h-4" />
        </Link>
        {canDelete && (
          <button
            type="button"
            title="Удалить"
            disabled={props.isDeletePending}
            onClick={() => {
              if (window.confirm(`Удалить лендинг «${landing.name}»?`)) props.onDelete();
            }}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-9 w-9 text-red-600 dark:text-red-400')}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
        <LandingActionsMenu {...props} />
      </div>
    </div>
  );
}
