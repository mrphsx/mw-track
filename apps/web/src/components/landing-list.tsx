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
import { Eye, Globe, Link2, MoreHorizontal, Shield, SplitSquareHorizontal, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LandingItem, LandingStatus, STATUS_LABEL, TYPE_LABEL, TemplateInfo } from '@/lib/landings';
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
  showProject,
}: {
  landing: LandingItem;
  showProject: boolean;
  onPreview: () => void;
  onManageDomain: () => void;
  onGetLink: () => void;
  onReupload?: () => void;
  onManageExternal?: () => void;
  onManageAbTest?: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
  isPublishPending: boolean;
  isDeletePending: boolean;
  canDelete?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  abTestGroupLabel?: string | null;
}) {
  const router = useRouter();
  const statsHref = `/projects/${landing.project.id}/landings/${landing.id}`;

  // Один и тот же запрос, что и раньше был в LandingCard — React Query дедуплицирует по ключу
  // независимо от того, сколько строк таблицы его вызывают.
  const { data: templates } = useQuery({
    queryKey: ['landing-templates'],
    queryFn: async () => (await api.get<TemplateInfo[]>('/landings/templates')).data,
    staleTime: 5 * 60 * 1000,
  });
  const templateName = landing.type === 'TEMPLATE' && landing.templateId ? templates?.find((t) => t.id === landing.templateId)?.name : null;

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
      </TableCell>
    </TableRow>
  );
}
