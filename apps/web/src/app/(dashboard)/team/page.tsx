'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Check, Copy, Link2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, Permission } from '@/lib/permissions';

type TeamRole = 'OWNER' | 'ADMIN' | 'BUYER' | 'OPERATOR';
type CreatableRole = 'ADMIN' | 'BUYER' | 'OPERATOR';

interface ProjectSummary {
  id: string;
  name: string;
}

interface TeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  role: TeamRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  projectAccess: { project: { id: string; name: string } }[];
  permissions: { permission: Permission }[];
}

interface TeamInvite {
  id: string;
  token: string;
  role: CreatableRole;
  projectIds: string[] | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

const ROLE_LABELS: Record<TeamRole, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  BUYER: 'Байер',
  OPERATOR: 'Оператор',
};

const ROLE_HINTS: Record<CreatableRole, string> = {
  ADMIN: 'Полный доступ ко всем проектам и команде компании, кроме биллинга.',
  BUYER: 'Лендинги, канал/бот, пуши и статистика — только выбранных проектов.',
  OPERATOR: 'Клиенты и депозиты — только выбранных проектов.',
};

function genPassword(): string {
  return Math.random().toString(36).slice(-5) + Math.random().toString(36).slice(-5).toUpperCase() + '!1';
}

export default function TeamPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isOwner = currentUser?.role === 'OWNER' || currentUser?.role === 'SUPER_ADMIN';

  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string } | null>(null);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);

  const { data: members, isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: async () => (await api.get<TeamMember[]>('/team')).data,
  });

  const { data: invites } = useQuery({
    queryKey: ['team-invites'],
    queryFn: async () => (await api.get<TeamInvite[]>('/team-invites')).data,
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete(`/team/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
  });

  const revokeInvite = useMutation({
    mutationFn: (id: string) => api.delete(`/team-invites/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team-invites'] }),
  });

  const pendingInvites = invites?.filter((i) => !i.usedAt && new Date(i.expiresAt) > new Date());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Команда</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowInvite(true)}>
            <Link2 className="w-4 h-4 mr-1.5" /> Пригласить по ссылке
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Добавить участника
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Роли: Admin — полный доступ, кроме биллинга. Buyer — лендинги/канал/пуши только своих
        проектов. Operator — клиенты/депозиты только своих проектов. Приглашений по почте пока нет —
        создайте аккаунт сами, либо сгенерируйте ссылку-приглашение (действует 7 дней, одноразовая) —
        человек сам заведёт себе пароль по ней.
      </p>

      {!!pendingInvites?.length && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ссылка-приглашение</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Действует до</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvites.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <InviteLinkCell token={inv.token} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ROLE_LABELS[inv.role]}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(inv.expiresAt).toLocaleDateString('ru-RU')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={revokeInvite.isPending}
                        onClick={() => {
                          if (confirm('Отозвать эту ссылку-приглашение?')) revokeInvite.mutate(inv.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}

      {!isLoading && !!members?.length && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Участник</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Проекты</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Последний вход</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => setEditMember(m)}
                        disabled={m.id === currentUser?.id}
                      >
                        <div className="font-medium">
                          {m.firstName} {m.lastName || ''}
                        </div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ROLE_LABELS[m.role]}</Badge>
                    </TableCell>
                    <TableCell>
                      {m.role === 'OWNER' || m.role === 'ADMIN' ? (
                        <span className="text-xs text-muted-foreground">Все проекты</span>
                      ) : m.projectAccess.length === 0 ? (
                        <span className="text-xs text-amber-600">Нет доступных проектов</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {m.projectAccess.map((pa) => pa.project.name).join(', ')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {m.isActive ? (
                        <Badge>Активен</Badge>
                      ) : (
                        <Badge variant="secondary">Отключён</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString('ru-RU') : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setEditMember(m)} disabled={m.id === currentUser?.id}>
                          Изменить
                        </Button>
                        {m.role !== 'OWNER' && m.isActive && (
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={m.id === currentUser?.id || removeMember.isPending}
                            onClick={() => {
                              if (confirm(`Отключить доступ участнику ${m.email}?`)) removeMember.mutate(m.id);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CreateMemberDialog
        open={showCreate}
        isOwner={isOwner}
        projects={projects || []}
        onClose={() => setShowCreate(false)}
        onCreated={(creds) => setCreatedCreds(creds)}
      />

      <InviteLinkDialog
        open={showInvite}
        isOwner={isOwner}
        projects={projects || []}
        onClose={() => setShowInvite(false)}
        onCreated={(url) => setCreatedInviteUrl(url)}
      />

      <EditMemberDialog
        member={editMember}
        isOwner={isOwner}
        projects={projects || []}
        onClose={() => setEditMember(null)}
      />

      <Dialog open={!!createdCreds} onOpenChange={(open) => !open && setCreatedCreds(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Участник создан</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Пароль показывается один раз — передайте его участнику лично, он больше нигде не сохранён.
            </p>
            {createdCreds && (
              <>
                <CredRow label="Email" value={createdCreds.email} />
                <CredRow label="Пароль" value={createdCreds.password} />
              </>
            )}
            <Button onClick={() => setCreatedCreds(null)}>Готово</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdInviteUrl} onOpenChange={(open) => !open && setCreatedInviteUrl(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ссылка-приглашение готова</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Действует 7 дней и одноразовая — после перехода и регистрации ссылка становится
              недействительной. Отправьте её приглашённому любым удобным способом.
            </p>
            {createdInviteUrl && <CredRow label="Ссылка" value={createdInviteUrl} />}
            <Button onClick={() => setCreatedInviteUrl(null)}>Готово</Button>
          </div>
        </DialogContent>
      </Dialog>

      <TeamAnalyticsSection />
    </div>
  );
}

// Team Analytics (Фаза 3.6, запрос пользователя 2026-07-15) — атрибуция клиента к баеру через
// скрытый параметр трекинг-ссылки (Client.buyerId), не через лендинг (лендинг/пиксель могут
// делить несколько баеров). Бэкенд (GET /team/analytics/*) уже защищён тем же class-level
// @Roles(OWNER) на TeamController, что и остальной /team — доп. проверка на фронтенде не нужна.
interface BuyerAnalyticsRow {
  userId: string;
  name: string;
  role: TeamRole;
  clients: number;
  revenue: number;
}

interface BuyerAnalytics {
  buyers: BuyerAnalyticsRow[];
  unattributed: { clients: number; revenue: number };
}

interface ProjectComparisonRow {
  id: string;
  name: string;
  totalClients: number;
  newClients: number;
  totalRevenue: number;
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function TeamAnalyticsSection() {
  const { data: buyerStats } = useQuery({
    queryKey: ['team', 'analytics', 'buyers'],
    queryFn: async () => (await api.get<BuyerAnalytics>('/team/analytics/buyers')).data,
  });

  const { data: projectStats } = useQuery({
    queryKey: ['team', 'analytics', 'projects'],
    queryFn: async () => (await api.get<ProjectComparisonRow[]>('/team/analytics/projects')).data,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-3">Статистика по рекламщикам</h2>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Имя</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Клиентов</TableHead>
                  <TableHead>Выручка</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buyerStats?.buyers.map((b) => (
                  <TableRow key={b.userId}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell>{ROLE_LABELS[b.role]}</TableCell>
                    <TableCell>{b.clients}</TableCell>
                    <TableCell>{formatMoney(b.revenue)}</TableCell>
                  </TableRow>
                ))}
                {buyerStats && (
                  <TableRow>
                    <TableCell className="font-medium text-muted-foreground" colSpan={2}>
                      БЕЗ БАЕРА
                    </TableCell>
                    <TableCell>{buyerStats.unattributed.clients}</TableCell>
                    <TableCell>{formatMoney(buyerStats.unattributed.revenue)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Сравнение проектов</h2>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Проект</TableHead>
                  <TableHead>Клиентов всего</TableHead>
                  <TableHead>Новых за 30 дней</TableHead>
                  <TableHead>Выручка</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectStats?.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.totalClients}</TableCell>
                    <TableCell>{p.newClients}</TableCell>
                    <TableCell>{formatMoney(p.totalRevenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InviteLinkCell({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}/invite/${token}` : '';

  const handleCopy = async () => {
    await copyToClipboard(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-2 max-w-xs">
      <span className="font-mono text-xs truncate">{url}</span>
      <Button size="icon" variant={copied ? 'default' : 'outline'} onClick={handleCopy}>
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </Button>
    </div>
  );
}

function CredRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await copyToClipboard(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="font-mono text-sm truncate">{value}</div>
      </div>
      <Button size="icon" variant={copied ? 'default' : 'outline'} onClick={handleCopy}>
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </Button>
    </div>
  );
}

function ProjectChecklist({
  projects,
  selected,
  onToggle,
}: {
  projects: ProjectSummary[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (projects.length === 0) {
    return <p className="text-xs text-muted-foreground">В компании пока нет проектов.</p>;
  }
  return (
    <div className="space-y-1.5 max-h-40 overflow-y-auto border rounded-md p-2">
      {projects.map((p) => (
        <label key={p.id} className="flex items-center gap-1.5 text-sm">
          <Checkbox checked={selected.includes(p.id)} onCheckedChange={() => onToggle(p.id)} />
          {p.name}
        </label>
      ))}
    </div>
  );
}

// Матрица прав (запрос пользователя 2026-07-17: "кто что может делать, удалять, создавать,
// менять лэндинги, пиксели, домены, пуши итд") — сгруппирована по ресурсу (см.
// PERMISSION_GROUPS), переиспользуется в обоих диалогах (создание/редактирование).
function PermissionMatrix({ selected, onToggle }: { selected: Permission[]; onToggle: (p: Permission) => void }) {
  return (
    <div className="space-y-3 max-h-72 overflow-y-auto border rounded-md p-3">
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="text-xs font-medium text-muted-foreground mb-1">{group.label}</div>
          <div className="grid grid-cols-2 gap-1">
            {group.permissions.map((p) => (
              <label key={p.value} className="flex items-center gap-1.5 text-sm">
                <Checkbox checked={selected.includes(p.value)} onCheckedChange={() => onToggle(p.value)} />
                {p.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function InviteLinkDialog({
  open,
  isOwner,
  projects,
  onClose,
  onCreated,
}: {
  open: boolean;
  isOwner: boolean;
  projects: ProjectSummary[];
  onClose: () => void;
  onCreated: (url: string) => void;
}) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<CreatableRole>('BUYER');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>(DEFAULT_ROLE_PERMISSIONS.BUYER);
  const [error, setError] = useState('');

  const resetForm = () => {
    setRole('BUYER');
    setProjectIds([]);
    setPermissions(DEFAULT_ROLE_PERMISSIONS.BUYER);
    setError('');
  };

  const onRoleChange = (v: string | null) => {
    if (!v) return;
    setRole(v as CreatableRole);
    setPermissions(DEFAULT_ROLE_PERMISSIONS[v] ?? []);
  };

  const create = useMutation({
    mutationFn: () =>
      api.post<{ token: string }>('/team-invites', {
        role,
        projectIds: role === 'ADMIN' ? undefined : projectIds,
        permissions: role === 'ADMIN' ? undefined : permissions,
      }),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['team-invites'] });
      onCreated(`${window.location.origin}/invite/${data.token}`);
      resetForm();
      onClose();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать ссылку'),
  });

  const close = () => {
    onClose();
    resetForm();
  };

  const needsProjects = role !== 'ADMIN';
  const canSubmit = !needsProjects || projectIds.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ссылка-приглашение</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Роль</Label>
            <Select value={role} onValueChange={onRoleChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {isOwner && <SelectItem value="ADMIN">Администратор</SelectItem>}
                <SelectItem value="BUYER">Байер</SelectItem>
                <SelectItem value="OPERATOR">Оператор</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{ROLE_HINTS[role]}</p>
          </div>
          {needsProjects && (
            <Tabs defaultValue="projects">
              <TabsList>
                <TabsTrigger value="projects">Проекты</TabsTrigger>
                <TabsTrigger value="permissions">Разрешения</TabsTrigger>
              </TabsList>
              <TabsContent value="projects" className="mt-2">
                <ProjectChecklist
                  projects={projects}
                  selected={projectIds}
                  onToggle={(id) => setProjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
                />
              </TabsContent>
              <TabsContent value="permissions" className="mt-2">
                <PermissionMatrix
                  selected={permissions}
                  onToggle={(p) => setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))}
                />
              </TabsContent>
            </Tabs>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}>
            {create.isPending ? 'Создаём...' : 'Создать ссылку'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateMemberDialog({
  open,
  isOwner,
  projects,
  onClose,
  onCreated,
}: {
  open: boolean;
  isOwner: boolean;
  projects: ProjectSummary[];
  onClose: () => void;
  onCreated: (creds: { email: string; password: string }) => void;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(genPassword());
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<CreatableRole>('BUYER');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>(DEFAULT_ROLE_PERMISSIONS.BUYER);
  const [error, setError] = useState('');

  const resetForm = () => {
    setEmail('');
    setPassword(genPassword());
    setFirstName('');
    setLastName('');
    setRole('BUYER');
    setProjectIds([]);
    setPermissions(DEFAULT_ROLE_PERMISSIONS.BUYER);
    setError('');
  };

  const onRoleChange = (v: string | null) => {
    if (!v) return;
    setRole(v as CreatableRole);
    setPermissions(DEFAULT_ROLE_PERMISSIONS[v] ?? []);
  };

  const create = useMutation({
    mutationFn: () =>
      api.post('/team', {
        email,
        password,
        firstName,
        lastName: lastName || undefined,
        role,
        projectIds: role === 'ADMIN' ? undefined : projectIds,
        permissions: role === 'ADMIN' ? undefined : permissions,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team'] });
      onCreated({ email, password });
      resetForm();
      onClose();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать участника'),
  });

  const close = () => {
    onClose();
    resetForm();
  };

  const needsProjects = role !== 'ADMIN';
  const canSubmit = email && password.length >= 8 && firstName && (!needsProjects || projectIds.length > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Новый участник</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="tm-first">Имя</Label>
              <Input id="tm-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-last">Фамилия</Label>
              <Input id="tm-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tm-email">Email</Label>
            <Input id="tm-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tm-pass">Временный пароль</Label>
            <div className="flex gap-2">
              <Input id="tm-pass" value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
              <Button type="button" variant="outline" onClick={() => setPassword(genPassword())}>
                Сгенерировать
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Роль</Label>
            <Select value={role} onValueChange={onRoleChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {isOwner && <SelectItem value="ADMIN">Администратор</SelectItem>}
                <SelectItem value="BUYER">Байер</SelectItem>
                <SelectItem value="OPERATOR">Оператор</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{ROLE_HINTS[role]}</p>
          </div>
          {needsProjects && (
            <Tabs defaultValue="projects">
              <TabsList>
                <TabsTrigger value="projects">Проекты</TabsTrigger>
                <TabsTrigger value="permissions">Разрешения</TabsTrigger>
              </TabsList>
              <TabsContent value="projects" className="mt-2">
                <ProjectChecklist
                  projects={projects}
                  selected={projectIds}
                  onToggle={(id) => setProjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
                />
              </TabsContent>
              <TabsContent value="permissions" className="mt-2">
                <PermissionMatrix
                  selected={permissions}
                  onToggle={(p) => setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))}
                />
              </TabsContent>
            </Tabs>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}>
            {create.isPending ? 'Создаём...' : 'Создать'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({
  member,
  isOwner,
  projects,
  onClose,
}: {
  member: TeamMember | null;
  isOwner: boolean;
  projects: ProjectSummary[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<CreatableRole>('BUYER');
  const [isActive, setIsActive] = useState(true);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [error, setError] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (member && loadedFor !== member.id) {
    setRole(member.role === 'OWNER' ? 'ADMIN' : (member.role as CreatableRole));
    setIsActive(member.isActive);
    setProjectIds(member.projectAccess.map((pa) => pa.project.id));
    setPermissions(member.permissions.map((p) => p.permission));
    setLoadedFor(member.id);
  }

  const onRoleChange = (v: string | null) => {
    if (!v) return;
    setRole(v as CreatableRole);
    setPermissions(DEFAULT_ROLE_PERMISSIONS[v] ?? []);
  };

  const update = useMutation({
    mutationFn: () =>
      api.patch(`/team/${member!.id}`, {
        role,
        isActive,
        projectIds: role === 'ADMIN' ? undefined : projectIds,
        permissions: role === 'ADMIN' ? undefined : permissions,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team'] });
      close();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить изменения'),
  });

  const close = () => {
    onClose();
    setLoadedFor(null);
    setError('');
  };

  if (!member) return null;

  const needsProjects = role !== 'ADMIN';
  const isOwnerRow = member.role === 'OWNER';

  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {member.firstName} {member.lastName || ''}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {isOwnerRow ? (
            <p className="text-sm text-muted-foreground">Владельца компании изменить нельзя.</p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Роль</Label>
                <Select value={role} onValueChange={onRoleChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {isOwner && <SelectItem value="ADMIN">Администратор</SelectItem>}
                    <SelectItem value="BUYER">Байер</SelectItem>
                    <SelectItem value="OPERATOR">Оператор</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{ROLE_HINTS[role]}</p>
              </div>
              {needsProjects && (
                <Tabs defaultValue="projects">
                  <TabsList>
                    <TabsTrigger value="projects">Проекты</TabsTrigger>
                    <TabsTrigger value="permissions">Разрешения</TabsTrigger>
                  </TabsList>
                  <TabsContent value="projects" className="mt-2">
                    <ProjectChecklist
                      projects={projects}
                      selected={projectIds}
                      onToggle={(id) => setProjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
                    />
                  </TabsContent>
                  <TabsContent value="permissions" className="mt-2">
                    <PermissionMatrix
                      selected={permissions}
                      onToggle={(p) => setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))}
                    />
                  </TabsContent>
                </Tabs>
              )}
              <div className="flex items-center justify-between border rounded-md px-3 py-2">
                <Label htmlFor="tm-active">Активен</Label>
                <Switch id="tm-active" checked={isActive} onCheckedChange={setIsActive} />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button onClick={() => update.mutate()} disabled={(needsProjects && projectIds.length === 0) || update.isPending}>
                {update.isPending ? 'Сохраняем...' : 'Сохранить'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
