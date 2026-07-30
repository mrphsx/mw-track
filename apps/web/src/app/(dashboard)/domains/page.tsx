'use client';

import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Check, Copy, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard, buildAutoPath } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '@/store/auth.store';
import { hasAnyPermission } from '@/lib/permissions';

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

// Ровно одно из двух (запрос пользователя 2026-07-17) — путь либо на конкретный лендинг, либо
// на группу A/B-теста напрямую (см. AbTestGroupDialog в components/landing-card.tsx). Эта
// страница пока создаёт только лендинг-привязки (группа привязывается из диалога A/B-теста),
// но должна корректно ПОКАЗЫВАТЬ уже существующие групповые привязки, а не падать на них.
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

interface DomainItem {
  id: string;
  domain: string;
  status: DomainStatus;
  sslStatus: string | null;
  paths: DomainPathItem[];
  lastCheckError: string | null;
  instructions: {
    txtName: string;
    txtValue: string;
    aRecordTarget: string | null;
  };
}

const STATUS_LABEL: Record<DomainStatus, string> = {
  PENDING: '🟡 Требуется верификация',
  VERIFYING: '🔵 Проверяем',
  ACTIVE: '🟢 Активен',
  ERROR: '🔴 Ошибка',
};

const STATUS_BADGE: Record<DomainStatus, 'outline' | 'secondary' | 'default' | 'destructive'> = {
  PENDING: 'secondary',
  VERIFYING: 'outline',
  ACTIVE: 'default',
  ERROR: 'destructive',
};

function pathUrl(domain: string, path: string): string {
  return `https://${domain}${path === '/' ? '' : path}`;
}

export default function DomainsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [error, setError] = useState('');
  const [pathsDomainId, setPathsDomainId] = useState<string | null>(null);

  const { data: domains, isLoading } = useQuery({
    queryKey: ['domains'],
    queryFn: async () => (await api.get<DomainItem[]>('/domains')).data,
  });

  const addDomain = useMutation({
    mutationFn: () => api.post('/domains', { domain: newDomain.trim().toLowerCase() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      setShowAddModal(false);
      setNewDomain('');
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['domains'] }),
  });

  const pathsDomain = domains?.find((d) => d.id === pathsDomainId) || null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Домены</h1>
        {hasAnyPermission(user, 'DOMAINS_CREATE') && (
          <Button onClick={() => setShowAddModal(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Добавить домен
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
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

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}

      {!isLoading && domains?.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">Доменов пока нет.</CardContent>
        </Card>
      )}

      {!!domains?.length && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Домен</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>SSL</TableHead>
                  <TableHead>Пути</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((d) => (
                  <Fragment key={d.id}>
                    <TableRow>
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          onClick={() => setPathsDomainId(d.id)}
                          className="hover:underline text-left"
                          title="Открыть пути этого домена"
                        >
                          {d.domain}
                        </button>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{d.sslStatus || '—'}</TableCell>
                      <TableCell>
                        {d.paths.length === 0 ? (
                          <span className="text-xs text-muted-foreground">Путей нет</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {d.paths.slice(0, 2).map((p) => (
                              <a
                                key={p.id}
                                href={pathUrl(d.domain, p.path)}
                                target="_blank"
                                rel="noopener"
                                className="text-xs font-mono text-muted-foreground hover:underline truncate max-w-[220px]"
                              >
                                {p.path} → {pathTargetLabel(p)}
                              </a>
                            ))}
                            {d.paths.length > 2 && (
                              <button type="button" onClick={() => setPathsDomainId(d.id)} className="text-xs text-muted-foreground hover:underline text-left">
                                +{d.paths.length - 2} ещё
                              </button>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          {d.status !== 'ACTIVE' && (
                            <Button size="sm" variant="outline" disabled={verifyDomain.isPending} onClick={() => verifyDomain.mutate(d.id)}>
                              Проверить →
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setPathsDomainId(d.id)}>
                            Пути
                          </Button>
                          {hasAnyPermission(user, 'DOMAINS_DELETE') && (
                            <Button size="sm" variant="ghost" onClick={() => removeDomain.mutate(d.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {d.status !== 'ACTIVE' && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-amber-50">
                          <div className="space-y-2 py-2 text-sm">
                            {d.lastCheckError && <p className="text-red-600">⚠️ {d.lastCheckError}</p>}
                            <p className="text-muted-foreground">Добавьте в DNS вашего домена три записи:</p>
                            <DnsRow label="TXT" name={d.instructions.txtName} value={d.instructions.txtValue} />
                            <DnsRow
                              label="A"
                              name={d.domain}
                              value={d.instructions.aRecordTarget || 'IP сервера (уточняется)'}
                            />
                            <DnsRow
                              label="A"
                              name={`www.${d.domain}`}
                              value={d.instructions.aRecordTarget || 'IP сервера (уточняется)'}
                            />
                            <p className="text-xs text-muted-foreground">
                              Запись на www обязательна — сертификат всегда выпускается сразу на домен и на www.
                              домен вместе.
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showAddModal} onOpenChange={(open) => !open && setShowAddModal(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Новый домен</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-domain">Домен</Label>
              <Input id="new-domain" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="example.com" />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button onClick={() => addDomain.mutate()} disabled={!newDomain || addDomain.isPending}>
              {addDomain.isPending ? 'Добавляем...' : 'Добавить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DomainPathsDialog domain={pathsDomain} onClose={() => setPathsDomainId(null)} />
    </div>
  );
}

// Project -> Landing (каскадный выбор вместо одного длинного списка лендингов всех проектов
// сразу) — запрос пользователя: при большом числе проектов плоский дропдаун со всеми лендингами
// становится неюзабельным. Путь -> один лендинг ЛЮБОГО проекта компании (Domain.projectId ни на
// что не влияет, см. note в CreateDomainDto), поэтому выбор проекта здесь — просто способ сузить
// список лендингов, а не ограничение.
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
          пути" — max-w-lg (512px) было тесно и для длинных URL путей, и особенно для строки
          "Добавить путь" (Input + 2 Select в один ряд). Расширено до max-w-3xl, форма добавления
          получила flex-wrap на случай узких экранов. */}
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
                  <SelectValue placeholder="Проект" />
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
                  <SelectValue placeholder="Лендинг" />
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
