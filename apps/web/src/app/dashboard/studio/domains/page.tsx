'use client';

import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Check, Copy, ExternalLink, Plus, ShieldOff, Trash2, UserCog } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard, buildAutoPath } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '@/store/auth.store';
import { hasAnyPermission, isElevatedUser } from '@/lib/permissions';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../ui';

type DomainStatus = 'PENDING' | 'VERIFYING' | 'ACTIVE' | 'ERROR';

interface ProjectSummary {
  id: string;
  name: string;
}

interface LandingApiItem {
  id: string;
  name: string;
  status: string;
}

interface DomainPathItem {
  id: string;
  path: string;
  landing: { id: string; name: string; project: { id: string; name: string } } | null;
  abTestGroup: { id: string; name: string | null; landings: { name: string }[] } | null;
}

function pathTargetLabel(p: DomainPathItem): string {
  if (p.landing) return p.landing.name;
  if (p.abTestGroup) return p.abTestGroup.name || `Тест: ${p.abTestGroup.landings.map((l) => l.name).join(', ')}`;
  return '—';
}

function pathTargetSubtitle(p: DomainPathItem): string {
  if (p.landing) return p.landing.project.name;
  if (p.abTestGroup) return 'Группа A/B-теста';
  return '';
}

// Сотрудник, которому можно выдать домен (не-elevated роли) — приходит и в списке доменов
// (кому уже выдан), и отдельным запросом для формы выбора.
interface AssignableUser {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  role: string;
}

function userLabel(u: AssignableUser): string {
  const name = `${u.firstName} ${u.lastName || ''}`.trim();
  return name || u.email;
}

interface DomainItem {
  id: string;
  domain: string;
  status: DomainStatus;
  sslStatus: string | null;
  paths: DomainPathItem[];
  // Доступ к домену (запрос пользователя 2026-10-06). allowedUsers приходит пустым для ролей,
  // которые не управляют доступом — им незачем знать, кому ещё выдан домен.
  sharedWithAllBuyers: boolean;
  allowedUsers: AssignableUser[];
  lastCheckError: string | null;
  instructions: {
    txtName: string;
    txtValue: string;
    aRecordTarget: string | null;
  };
}

const STATUS_LABEL: Record<DomainStatus, string> = {
  PENDING: 'Требуется верификация',
  VERIFYING: 'Проверяем',
  ACTIVE: 'Активен',
  ERROR: 'Ошибка',
};

const STATUS_HUE: Record<DomainStatus, 'amber' | 'sage' | 'slate' | 'plum' | 'teal'> = {
  PENDING: 'teal',
  VERIFYING: 'amber',
  ACTIVE: 'sage',
  ERROR: 'plum',
};

function pathUrl(domain: string, path: string): string {
  return `https://${domain}${path === '/' ? '' : path}`;
}

// Studio-версия страницы доменов (запрос пользователя 2026-07-30: "готовить все остальные
// страницы") — логика 1:1 с классической (apps/web/.../(dashboard)/domains/page.tsx). Оба
// диалога (добавление домена, управление путями) переиспользованы как обычные shadcn Dialog без
// Studio-переоформления — тот же принцип, что и у остальных диалогов в Studio (сложные разовые
// модалки не форкаются, реskin получает только основная таблица/шапка страницы).
export default function StudioDomainsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [error, setError] = useState('');
  const [pathsDomainId, setPathsDomainId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  // Доступ к доменам (запрос пользователя 2026-10-06) — настраивают только владелец/админ.
  const canManageAccess = isElevatedUser(user);
  const [accessDomainId, setAccessDomainId] = useState<string | null>(null);
  const [showRevokeAll, setShowRevokeAll] = useState(false);
  const [newShareAll, setNewShareAll] = useState(false);
  const [newAllowedIds, setNewAllowedIds] = useState<string[]>([]);

  const { data: domains, isLoading } = useQuery({
    queryKey: ['domains'],
    queryFn: async () => (await api.get<DomainItem[]>('/domains')).data,
  });

  const { data: assignableUsers } = useQuery({
    queryKey: ['domain-assignable-users'],
    queryFn: async () => (await api.get<AssignableUser[]>('/domains/access/assignable-users')).data,
    enabled: canManageAccess,
  });

  const addDomain = useMutation({
    mutationFn: () =>
      api.post('/domains', {
        domain: newDomain.trim().toLowerCase(),
        // Выбор присылается всегда, даже «никому»: иначе бэкенд применил бы дефолт схемы
        // (доступен всем) и новый домен молча оказался бы у всех.
        ...(canManageAccess ? { sharedWithAllBuyers: newShareAll, allowedUserIds: newShareAll ? [] : newAllowedIds } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      setShowAddModal(false);
      setNewDomain('');
      setNewShareAll(false);
      setNewAllowedIds([]);
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось добавить домен'),
  });

  const verifyDomain = useMutation({
    mutationFn: (id: string) => api.post(`/domains/${id}/verify`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['domains'] }),
  });

  const removeDomain = useMutation({
    mutationFn: (id: string) => api.delete(`/domains/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      setDeleteConfirmId(null);
    },
  });

  const revokeAllAccess = useMutation({
    mutationFn: () => api.post('/domains/access/revoke-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      setShowRevokeAll(false);
    },
  });

  const accessDomain = domains?.find((d) => d.id === accessDomainId) || null;
  const pathsDomain = domains?.find((d) => d.id === pathsDomainId) || null;
  const deleteConfirmDomain = domains?.find((d) => d.id === deleteConfirmId) || null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Домены</h1>
        <div className="flex items-center gap-2">
          {canManageAccess && !!domains?.length && (
            <StudioLinkButton icon={ShieldOff} onClick={() => setShowRevokeAll(true)}>
              Отозвать доступ у всех
            </StudioLinkButton>
          )}
          {hasAnyPermission(user, 'DOMAINS_CREATE') && (
            <StudioLinkButton variant="primary" icon={Plus} onClick={() => setShowAddModal(true)}>
              Добавить домен
            </StudioLinkButton>
          )}
        </div>
      </div>

      <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
        Домен покупаете и настраиваете вы сами (в своём Cloudflare-аккаунте или у любого другого
        регистратора/DNS-провайдера) — мы не управляем вашим DNS. Добавьте три записи по инструкции
        ниже (включая A-запись на <code className="text-xs">www</code> — сертификат выпускается сразу
        на домен с <code className="text-xs">www</code> и без, без записи на <code className="text-xs">www</code>{' '}
        выпуск сертификата не пройдёт), затем нажмите «Проверить»: мы подтвердим владение доменом и
        выпустим SSL-сертификат. После этого нажмите на сам домен, чтобы привязать к нему один или
        несколько лендингов по пути (<code className="text-xs">/promo1</code>,{' '}
        <code className="text-xs">/promo2</code> и т.д., из разных проектов) — без явно настроенного
        пути голый домен никуда не ведёт.
      </p>

      {isLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {!isLoading && domains?.length === 0 && (
        <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>Доменов пока нет.</div>
      )}

      {!!domains?.length && (
        <div className={`${STUDIO_CARD} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                <th className="px-5 py-3 font-medium">Домен</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">SSL</th>
                <th className="px-5 py-3 font-medium">Пути</th>
                {canManageAccess && <th className="px-5 py-3 font-medium">Доступ</th>}
                <th className="px-5 py-3 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
              {domains.map((d) => (
                <Fragment key={d.id}>
                  <tr>
                    <td className="px-5 py-3 font-medium">
                      <button
                        type="button"
                        onClick={() => setPathsDomainId(d.id)}
                        className="hover:underline text-left text-[#131A24] dark:text-[#E9EDF3]"
                        title="Открыть пути этого домена"
                      >
                        {d.domain}
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      <StudioPill hue={STATUS_HUE[d.status]}>{STATUS_LABEL[d.status]}</StudioPill>
                    </td>
                    <td className="px-5 py-3 text-sm text-[#5F6B7A] dark:text-[#92A0AF]">{d.sslStatus || '—'}</td>
                    <td className="px-5 py-3">
                      {d.paths.length === 0 ? (
                        <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Путей нет</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {d.paths.slice(0, 2).map((p) => (
                            <a
                              key={p.id}
                              href={pathUrl(d.domain, p.path)}
                              target="_blank"
                              rel="noopener"
                              className="text-xs font-mono text-[#5F6B7A] dark:text-[#92A0AF] hover:underline truncate max-w-[220px]"
                            >
                              {p.path} → {pathTargetLabel(p)}
                            </a>
                          ))}
                          {d.paths.length > 2 && (
                            <button type="button" onClick={() => setPathsDomainId(d.id)} className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] hover:underline text-left">
                              +{d.paths.length - 2} ещё
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    {canManageAccess && (
                      <td className="px-5 py-3">
                        <button
                          type="button"
                          onClick={() => setAccessDomainId(d.id)}
                          className="text-left"
                          title="Настроить, кому доступен домен"
                        >
                          <StudioPill hue={d.sharedWithAllBuyers ? 'sage' : d.allowedUsers.length ? 'teal' : 'slate'}>
                            {d.sharedWithAllBuyers
                              ? 'Всем баерам'
                              : d.allowedUsers.length
                                ? `Выбранным: ${d.allowedUsers.length}`
                                : 'Только админам'}
                          </StudioPill>
                        </button>
                        {!d.sharedWithAllBuyers && !!d.allowedUsers.length && (
                          <div className="mt-1 text-xs text-[#5F6B7A] dark:text-[#92A0AF] truncate max-w-[200px]">
                            {d.allowedUsers.map(userLabel).join(', ')}
                          </div>
                        )}
                      </td>
                    )}
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {d.status !== 'ACTIVE' && (
                          <StudioLinkButton size="sm" disabled={verifyDomain.isPending} onClick={() => verifyDomain.mutate(d.id)}>
                            Проверить →
                          </StudioLinkButton>
                        )}
                        <StudioLinkButton size="sm" onClick={() => setPathsDomainId(d.id)}>
                          Пути
                        </StudioLinkButton>
                        {/* Отдельная кнопка на выдачу доступа (запрос пользователя 2026-10-06):
                            пилюля в колонке «Доступ» кликабельна и остаётся, но она маленькая и
                            не читается как действие. */}
                        {canManageAccess && (
                          <StudioLinkButton size="sm" icon={UserCog} onClick={() => setAccessDomainId(d.id)}>
                            Доступ
                          </StudioLinkButton>
                        )}
                        {hasAnyPermission(user, 'DOMAINS_DELETE') && (
                          <button type="button" onClick={() => setDeleteConfirmId(d.id)} className="text-[#5F6B7A] dark:text-[#92A0AF] hover:text-red-600 dark:hover:text-red-400">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {d.status !== 'ACTIVE' && (
                    <tr>
                      <td colSpan={canManageAccess ? 6 : 5} className="px-5 bg-[#A8783C]/5 dark:bg-[#E0B378]/5">
                        <div className="space-y-2 py-3 text-sm">
                          {d.lastCheckError && <p className="text-red-600 dark:text-red-400">⚠ {d.lastCheckError}</p>}
                          <p className="text-[#5F6B7A] dark:text-[#92A0AF]">Добавьте в DNS вашего домена три записи:</p>
                          <DnsRow label="TXT" name={d.instructions.txtName} value={d.instructions.txtValue} />
                          <DnsRow label="A" name={d.domain} value={d.instructions.aRecordTarget || 'IP сервера (уточняется)'} />
                          <DnsRow label="A" name={`www.${d.domain}`} value={d.instructions.aRecordTarget || 'IP сервера (уточняется)'} />
                          <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                            Запись на www обязательна — сертификат всегда выпускается сразу на домен и на www.
                            домен вместе.
                          </p>
                          <p className="text-sm bg-yellow-100 text-yellow-900 border border-yellow-300 rounded-md px-2.5 py-2 dark:bg-yellow-200/10 dark:text-yellow-300 dark:border-yellow-300/30">
                            Если домен проксируется через Cloudflare (оранжевое облако), обязательно
                            поставьте в Cloudflare SSL/TLS режим <strong>Full (strict)</strong>, а не
                            Flexible — иначе при срабатывании клоакинга или обычном HTTP→HTTPS редиректе
                            браузер получит <code className="text-xs">ERR_TOO_MANY_REDIRECTS</code>.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showAddModal} onOpenChange={(open) => !open && setShowAddModal(false)}>
        {/* Шире sm: внутри список сотрудников с почтами, в 384px он читается впритык.
            max-h/overflow — чтобы длинный список не выталкивал кнопку «Добавить» за экран. */}
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Новый домен</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-domain">Домен</Label>
              <Input id="new-domain" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="example.com" />
            </div>
            <p className="text-sm bg-yellow-100 text-yellow-900 border border-yellow-300 rounded-md px-2.5 py-2 dark:bg-yellow-200/10 dark:text-yellow-300 dark:border-yellow-300/30">
              Если домен проксируется через Cloudflare (оранжевое облако), обязательно поставьте в
              Cloudflare SSL/TLS режим <strong>Full (strict)</strong>, а не Flexible — иначе при
              срабатывании клоакинга или обычном HTTP→HTTPS редиректе браузер получит{' '}
              <code className="text-xs">ERR_TOO_MANY_REDIRECTS</code>.
            </p>
            {canManageAccess && (
              <AccessPicker
                users={assignableUsers}
                shareAll={newShareAll}
                allowedIds={newAllowedIds}
                onShareAllChange={setNewShareAll}
                onAllowedIdsChange={setNewAllowedIds}
              />
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button onClick={() => addDomain.mutate()} disabled={!newDomain || addDomain.isPending}>
              {addDomain.isPending ? 'Добавляем...' : 'Добавить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmDomain} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить домен?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
              Домен{' '}
              <span className="font-medium text-[#131A24] dark:text-[#E9EDF3]">{deleteConfirmDomain?.domain}</span>{' '}
              перестанет работать (nginx/сертификат снимаются), но запись останется в базе — при необходимости
              можно будет разобраться в истории. Добавить этот же домен заново после удаления можно.
            </p>
            <div className="flex justify-end gap-2">
              <StudioLinkButton onClick={() => setDeleteConfirmId(null)}>Отмена</StudioLinkButton>
              <Button
                variant="destructive"
                disabled={removeDomain.isPending}
                onClick={() => deleteConfirmId && removeDomain.mutate(deleteConfirmId)}
              >
                {removeDomain.isPending ? 'Удаляем...' : 'Удалить'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showRevokeAll} onOpenChange={(open) => !open && setShowRevokeAll(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Отозвать доступ у всех?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
              Со всех доменов компании снимется и общий доступ «всем баерам», и все точечные выдачи
              конкретным сотрудникам. Домены останутся видны только владельцу и администраторам, пока вы
              не выдадите доступ заново. Сами домены, пути и сертификаты не затрагиваются.
            </p>
            <div className="flex justify-end gap-2">
              <StudioLinkButton onClick={() => setShowRevokeAll(false)}>Отмена</StudioLinkButton>
              <Button variant="destructive" disabled={revokeAllAccess.isPending} onClick={() => revokeAllAccess.mutate()}>
                {revokeAllAccess.isPending ? 'Отзываем...' : 'Отозвать доступ'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DomainAccessDialog domain={accessDomain} users={assignableUsers} onClose={() => setAccessDomainId(null)} />
      <DomainPathsDialog domain={pathsDomain} onClose={() => setPathsDomainId(null)} />
    </div>
  );
}

// Общий выбор «кому доступен домен» — один и тот же блок в форме создания и в диалоге правки
// доступа у существующего домена, чтобы два места не разъехались по смыслу.
function AccessPicker({
  users,
  shareAll,
  allowedIds,
  onShareAllChange,
  onAllowedIdsChange,
}: {
  users: AssignableUser[] | undefined;
  shareAll: boolean;
  allowedIds: string[];
  onShareAllChange: (v: boolean) => void;
  onAllowedIdsChange: (v: string[]) => void;
}) {
  const toggle = (id: string) =>
    onAllowedIdsChange(allowedIds.includes(id) ? allowedIds.filter((x) => x !== id) : [...allowedIds, id]);

  return (
    /* min-w-0 на каждом уровне вверх до грид-ячейки DialogContent: без этого длинная почта
       задаёт колонке грида свою ширину (min-width ячейки по умолчанию auto), и содержимое
       вылезает за попап целиком — именно это и был визуальный баг. */
    <div className="min-w-0 space-y-2">
      <Label>Кому доступен</Label>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={shareAll} onChange={(e) => onShareAllChange(e.target.checked)} />
        <span>Всем баерам компании (включая будущих)</span>
      </label>

      {!shareAll && (
        <>
          {!users?.length ? (
            <p className="text-xs text-muted-foreground">В компании пока нет сотрудников, которым можно выдать домен.</p>
          ) : (
            /* Высота списка от экрана, а не фиксированные 11rem (запрос пользователя 2026-10-06:
               "чтобы больше баеров помещалось на экране без скрола"): на большом мониторе
               показываем до 55% высоты окна, на маленьком — не разрастаемся за пределы попапа.
               Сам попап ограничен 85vh и скроллится, так что список не может выдавить кнопки. */
            <div className="max-h-[min(55vh,34rem)] space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {users.map((u) => (
                /* Имя и почта в две строки, а не в одну: почта длиннее ширины диалога почти
                   всегда, и в один ряд она либо выдавливала имя, либо вылезала за край. У
                   обёртки обязателен min-w-0 — без него truncate внутри flex не срабатывает
                   (ячейка flex не сжимается уже своего содержимого). */
                <label key={u.id} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
                  <input type="checkbox" className="mt-1 shrink-0" checked={allowedIds.includes(u.id)} onChange={() => toggle(u.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{userLabel(u)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {!allowedIds.length && (
            <p className="text-xs text-muted-foreground">
              Никого не выбрано — домен будет виден только владельцу и администраторам.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function DomainAccessDialog({
  domain,
  users,
  onClose,
}: {
  domain: DomainItem | null;
  users: AssignableUser[] | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [shareAll, setShareAll] = useState(false);
  const [allowedIds, setAllowedIds] = useState<string[]>([]);

  // Префилл из самого домена при каждом открытии. key={domain.id} на диалоге ниже не поставить
  // (компонент один на все строки), поэтому следим за id через useEffect.
  useEffect(() => {
    if (!domain) return;
    setShareAll(domain.sharedWithAllBuyers);
    setAllowedIds(domain.allowedUsers.map((u) => u.id));
  }, [domain?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/domains/${domain!.id}/access`, { sharedWithAllBuyers: shareAll, allowedUserIds: shareAll ? [] : allowedIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      onClose();
    },
  });

  return (
    <Dialog open={!!domain} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          {/* Домены бывают длинные — заголовок переносим, а не обрезаем. */}
          <DialogTitle className="break-all">Доступ к {domain?.domain}</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <AccessPicker
            users={users}
            shareAll={shareAll}
            allowedIds={allowedIds}
            onShareAllChange={setShareAll}
            onAllowedIdsChange={setAllowedIds}
          />
          <div className="flex justify-end gap-2">
            <StudioLinkButton onClick={onClose}>Отмена</StudioLinkButton>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Сохраняем...' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DomainPathsDialog({ domain, onClose }: { domain: DomainItem | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [path, setPath] = useState('/');
  const [projectId, setProjectId] = useState('');
  const [landingId, setLandingId] = useState('');
  const [error, setError] = useState('');

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
    enabled: !!domain,
  });

  const { data: landings } = useQuery({
    queryKey: ['project-landings', projectId],
    queryFn: async () => (await api.get<LandingApiItem[]>(`/projects/${projectId}/landings`)).data,
    enabled: !!projectId,
  });

  const resetForm = () => {
    setPath('/');
    setProjectId('');
    setLandingId('');
    setError('');
  };

  const upsertPath = useMutation({
    mutationFn: () => api.post(`/domains/${domain!.id}/paths`, { path, landingId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      resetForm();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось добавить путь'),
  });

  const removePath = useMutation({
    mutationFn: (pathId: string) => api.delete(`/domains/${domain!.id}/paths/${pathId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['domains'] }),
  });

  const close = () => {
    onClose();
    resetForm();
  };

  if (!domain) return null;

  return (
    <Dialog open={!!domain} onOpenChange={(open) => !open && close()}>
      {/* Баг-репорт пользователя 2026-07-30: "модальное окно слишком маленькое, не помещаются
          пути" — тот же фикс, что и в классической версии этого диалога. */}
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono">{domain.domain}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {domain.status !== 'ACTIVE' && (
            <p className="text-sm text-amber-600">
              Домен ещё не подтверждён — пути можно настроить заранее, но контент они начнут отдавать
              только после успешной верификации.
            </p>
          )}

          <div className="space-y-2">
            {domain.paths.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Путей пока нет — голый домен (включая корень <code className="text-xs">/</code>) ни на
                что не ведёт, пока не добавлен хотя бы один путь ниже.
              </p>
            )}
            {domain.paths.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 border rounded-md px-3 py-2">
                <div className="min-w-0 flex-1">
                  <a
                    href={pathUrl(domain.domain, p.path)}
                    target="_blank"
                    rel="noopener"
                    title={pathUrl(domain.domain, p.path)}
                    className="text-sm font-mono hover:underline flex items-center gap-1 min-w-0"
                  >
                    <span className="truncate min-w-0">{pathUrl(domain.domain, p.path)}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                  <p className="text-xs text-muted-foreground truncate">
                    {pathTargetSubtitle(p)} — {pathTargetLabel(p)}
                  </p>
                </div>
                <Button size="icon" variant="ghost" className="shrink-0" onClick={() => removePath.mutate(p.id)} disabled={removePath.isPending}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-2 border-t pt-3">
            <Label>Добавить путь</Label>
            <p className="text-xs text-muted-foreground">
              Путь подставляется автоматически по id проекта и лендинга — при необходимости его
              можно поправить вручную.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/promo1"
                className="w-28 font-mono text-sm shrink-0"
              />
              <Select
                value={projectId}
                onValueChange={(v) => {
                  if (!v) return;
                  setProjectId(v);
                  setLandingId('');
                  setPath('/');
                }}
              >
                <SelectTrigger className="flex-1 min-w-[160px]">
                  {/* Без children-функции Base UI показывает сырое id проекта вместо названия —
                      тот же повторяющийся баг, что уже чинился в проекте несколько раз (см.
                      get-link-dialog.tsx). */}
                  <SelectValue placeholder="Проект">{(v: string) => (v ? (projects?.find((p) => p.id === v)?.name ?? v) : 'Проект')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {projects?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={landingId}
                onValueChange={(v) => {
                  if (!v) return;
                  setLandingId(v);
                  setPath(buildAutoPath(projectId, v, domain.paths.map((p) => p.path)));
                }}
                disabled={!projectId}
              >
                <SelectTrigger className="flex-1 min-w-[160px]">
                  <SelectValue placeholder="Лендинг">{(v: string) => (v ? (landings?.find((l) => l.id === v)?.name ?? v) : 'Лендинг')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {landings?.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button size="sm" onClick={() => upsertPath.mutate()} disabled={!path || !landingId || upsertPath.isPending}>
              {upsertPath.isPending ? 'Добавляем...' : 'Добавить путь'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DnsRow({ label, name, value }: { label: string; name: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await copyToClipboard(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-3 font-mono text-xs bg-card border rounded-md px-3 py-2">
      <Badge variant="outline">{label}</Badge>
      <span className="text-muted-foreground">{name}</span>
      <span className="flex-1 truncate">{value}</span>
      <Button size="icon" variant={copied ? 'default' : 'outline'} onClick={handleCopy}>
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </Button>
    </div>
  );
}
