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
}: {
  landing: LandingItem;
  domains: DomainOption[] | undefined;
  showProject: boolean;
  onPreview: () => void;
  onManageDomain: () => void;
  onGetLink: () => void;
  onReupload?: () => void;
  onManageAbTest: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
  isPublishPending: boolean;
  isDeletePending: boolean;
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
}) {
  const router = useRouter();
  const channel = primaryChannel(landing);
  const title = channel ? channelTitle(channel) : '';
  const handle = channel ? channelHandle(channel) : '';
  const attachment = findLandingAttachment(domains, landing.id);
  const statsHref = `/projects/${landing.project.id}/landings/${landing.id}`;

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

  return (
    <Card
      onClick={() => (selectable ? !selectDisabled && onToggleSelect?.() : router.push(statsHref))}
      className={cn(
        'transition-colors',
        selectable && selectDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:ring-foreground/20',
        selectable && selected && 'ring-2 ring-primary',
      )}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium truncate">{landing.name}</p>
            {showProject && <p className="text-xs text-gray-500 truncate">{landing.project.name}</p>}
          </div>
          {selectable ? (
            <Checkbox checked={!!selected} disabled={selectDisabled} className="shrink-0" />
          ) : (
            <Badge variant={landing.status === 'PUBLISHED' ? 'default' : 'secondary'} className="shrink-0">
              {STATUS_LABEL[landing.status]}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline">{TYPE_LABEL[landing.type]}</Badge>
          {templateName && <Badge variant="outline">{templateName}</Badge>}
          {landing.abTestGroupId && <Badge variant="outline">{abTestGroupLabel || 'A/B-тест'}</Badge>}
        </div>

        {channel ? (
          <div className="flex items-center gap-2 border rounded-md p-2">
            <ChannelAvatar channelId={channel.id} hasAvatar={!!channel.tgAvatarFileId} fallbackLetter={title || handle || 'T'} />
            <div className="min-w-0 text-sm">
              {title && <p className="font-medium truncate">{title}</p>}
              <div className="flex items-center gap-1.5 text-gray-500">
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
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400">Канал не привязан к проекту</p>
        )}

        {attachment ? (
          <a
            href={attachmentUrl(attachment)}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
            className="block text-xs font-mono text-gray-500 hover:underline truncate"
          >
            {attachment.domain}
            {attachment.path === '/' ? '' : attachment.path}
          </a>
        ) : (
          <p className="text-xs text-gray-400">Домен не привязан</p>
        )}

        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <Users className="w-3.5 h-3.5" />
          {landing._count.clients} {landing._count.clients === 1 ? 'подписчик' : 'подписчиков'}
        </div>

        {/* Клик по карточке ведёт на страницу статистики лендинга — действия ниже не должны
            всплывать до Card.onClick, иначе кнопка "Удалить" и остальные тоже открывали бы её.
            В режиме выбора (selectable) сами действия не имеют смысла — клики по карточке
            должны только отмечать/снимать выбор. */}
        <div
          className={cn('flex items-center justify-end gap-1.5 pt-1 border-t', selectable && 'pointer-events-none opacity-40')}
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
          <Button size="sm" variant="ghost" onClick={onManageAbTest} title="A/B-тест">
            <SplitSquareHorizontal className="w-4 h-4" />
          </Button>
          {landing.type === 'CUSTOM' && onReupload && (
            <Button size="sm" variant="ghost" onClick={onReupload} title="Перезалить ZIP">
              <Upload className="w-4 h-4" />
            </Button>
          )}
          {landing.status === 'PUBLISHED' ? (
            <Button size="sm" variant="outline" onClick={onUnpublish} disabled={isPublishPending}>
              Снять с публикации
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
      </CardContent>
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
            <p className="text-sm text-gray-500">
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
  projectId: string;
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

  const { data: projectLandings } = useQuery({
    queryKey: ['landings', target?.projectId, 'ab-options'],
    queryFn: async () => (await api.get<LandingItem[]>(`/projects/${target!.projectId}/landings`)).data,
    enabled: !!target,
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

  useEffect(() => {
    if (!target || !projectLandings) return;
    const members = target.groupId ? projectLandings.filter((l) => l.abTestGroupId === target.groupId) : [];
    const initialIds = target.groupId ? members.map((l) => l.id) : target.preselectedIds;
    setCheckedIds(new Set(initialIds));
    setWeights(equalize(initialIds));
    setName(members.find((l) => l.abTestGroup?.name)?.abTestGroup?.name ?? '');
    setDomainSelection(currentGroupAttachment?.domainId ?? NO_DOMAIN);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.groupId, target?.projectId, target?.preselectedIds.join(','), !!projectLandings]);

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
      if (!target) return;
      let groupId = target.groupId;
      if (groupId) await api.patch(`/ab-test-groups/${groupId}`, { name: name || undefined, members });
      else {
        const res = await api.post<{ id: string }>(`/projects/${target.projectId}/ab-test-groups`, { name: name || undefined, members });
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
        await attachGroupToDomain(target.projectId, groupId, domainSelection, domains);
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
          <div className="space-y-1.5">
            <Label htmlFor="ab-group-name">Название теста (необязательно)</Label>
            <Input id="ab-group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, «Летняя акция»" />
          </div>

          {!projectLandings ? (
            <p className="text-sm text-gray-500">Загрузка...</p>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-0.5">
              {projectLandings.map((l) => {
                const checked = checkedIds.has(l.id);
                const disabled = !!l.abTestGroupId && l.abTestGroupId !== target.groupId;
                return (
                  <div key={l.id} className="flex items-center gap-2 py-1">
                    <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => !disabled && toggle(l.id)} />
                    <span className={cn('flex-1 truncate text-sm', disabled && 'text-gray-400')}>
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
                        <span className="text-xs text-gray-400">%</span>
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
              <p className="text-sm text-gray-500">
                Сейчас:{' '}
                <a href={attachmentUrl(currentGroupAttachment)} target="_blank" rel="noopener" className="font-mono hover:underline">
                  {currentGroupAttachment.domain}
                  {currentGroupAttachment.path === '/' ? '' : currentGroupAttachment.path}
                </a>
              </p>
            )}
            <DomainSelect id="ab-group-domain" value={domainSelection} onChange={setDomainSelection} domains={domains} />
            <p className="text-xs text-gray-400">
              Заход по этой ссылке распределяется между вариантами по проценту выше. Для ссылки на конкретный вариант
              отдельно — привяжите домен к самому лендингу (иконка домена на его карточке).
            </p>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={trySave} disabled={save.isPending}>
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
