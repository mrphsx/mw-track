'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Building2, Users, FolderOpen, LayoutTemplate, Globe, Wallet, ShieldAlert, Trash2, ChevronRight, Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatsCard } from '@/components/shared/stats-card';

interface Overview {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  plan: string;
  balance: string;
  planExpiresAt: string | null;
  teamSize: number;
  projectCount: number;
  landingCount: number;
  clientCount: number;
  domainCount: number;
  pushesBlocked: boolean;
  domainsBlocked: boolean;
  isSuspended: boolean;
}

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  _count: { pushes: number; clients: number };
}

interface LandingRow {
  id: string;
  name: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  project: { id: string; name: string };
  _count: { clients: number };
}

interface DomainRow {
  id: string;
  domain: string;
  status: string;
  sslStatus: string | null;
  project: { id: string; name: string } | null;
}

interface TeamRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

interface ErrorLogRow {
  id: string;
  message: string;
  route: string | null;
  statusCode: number | null;
  createdAt: string;
}

interface ActionLogRow {
  id: string;
  action: string;
  previousValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  createdAt: string;
  admin: { firstName: string; lastName: string | null };
}

// Дрилл-даун по одной компании (Фаза 4.3B, запрос пользователя 2026-07-19) — все данные читаются
// через новый /admin/companies/:id/* API (бэкенд оборачивает существующие сервисы через
// runAsCompany, см. память). Клиенты внутри проекта — отдельная страница
// /companies/[id]/projects/[projectId], не таб здесь (список проектов может быть не один).
export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [topUpOpen, setTopUpOpen] = useState(false);

  const { data: overview } = useQuery({
    queryKey: ['admin-company-overview', id],
    queryFn: async () => (await api.get<Overview>(`/admin/companies/${id}/overview`)).data,
  });

  const { data: projects } = useQuery({
    queryKey: ['admin-company-projects', id],
    queryFn: async () => (await api.get<ProjectRow[]>(`/admin/companies/${id}/projects`)).data,
  });

  const { data: landings } = useQuery({
    queryKey: ['admin-company-landings', id],
    queryFn: async () => (await api.get<LandingRow[]>(`/admin/companies/${id}/landings`)).data,
  });

  // Тот же приём, что и обычная кнопка "Предпросмотр" в CRM (apps/web landings/page.tsx) —
  // рендерит HTML лендинга и открывает его как blob в новой вкладке, без публикации/домена.
  const previewLanding = async (landingId: string) => {
    const res = await api.get(`/admin/companies/${id}/landings/${landingId}/preview`, { responseType: 'text' });
    const blob = new Blob([res.data as string], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  const { data: domains } = useQuery({
    queryKey: ['admin-company-domains', id],
    queryFn: async () => (await api.get<DomainRow[]>(`/admin/companies/${id}/domains`)).data,
  });

  const { data: team } = useQuery({
    queryKey: ['admin-company-team', id],
    queryFn: async () => (await api.get<TeamRow[]>(`/admin/companies/${id}/team`)).data,
  });

  const { data: errors } = useQuery({
    queryKey: ['admin-company-errors', id],
    queryFn: async () => (await api.get<{ items: ErrorLogRow[] }>('/admin/errors', { params: { companyId: id } })).data,
  });

  const { data: actions } = useQuery({
    queryKey: ['admin-company-actions', id],
    queryFn: async () => (await api.get<{ items: ActionLogRow[] }>('/admin/actions', { params: { companyId: id } })).data,
  });

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-2xl font-bold">
            <Building2 className="h-6 w-6" /> {overview?.name ?? '...'}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {overview?.slug} · план {overview?.plan} · с нами с{' '}
            {overview ? format(new Date(overview.createdAt), 'd MMMM yyyy', { locale: ru }) : '—'}
          </p>
        </div>
        <Button onClick={() => setTopUpOpen(true)}>
          <Wallet className="mr-1.5 h-4 w-4" /> Пополнить баланс
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatsCard label="Баланс" value={overview ? `$${Number(overview.balance).toFixed(2)}` : '—'} icon={Wallet} />
        <StatsCard label="Команда" value={overview?.teamSize ?? '—'} icon={Users} />
        <StatsCard label="Проекты" value={overview?.projectCount ?? '—'} icon={FolderOpen} />
        <StatsCard label="Клиенты" value={overview?.clientCount ?? '—'} icon={Users} />
        <StatsCard label="Лендинги" value={overview?.landingCount ?? '—'} icon={LayoutTemplate} />
        <StatsCard label="Домены" value={overview?.domainCount ?? '—'} icon={Globe} />
      </div>

      {topUpOpen && overview && (
        <TopUpDialog
          companyId={id}
          companyName={overview.name}
          onClose={() => setTopUpOpen(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['admin-company-overview', id] });
            queryClient.invalidateQueries({ queryKey: ['admin-company-actions', id] });
            setTopUpOpen(false);
          }}
        />
      )}

      {overview && <RestrictionsCard companyId={id} overview={overview} />}

      <Tabs defaultValue="projects">
        <TabsList>
          <TabsTrigger value="projects">Проекты</TabsTrigger>
          <TabsTrigger value="landings">Лендинги</TabsTrigger>
          <TabsTrigger value="domains">Домены</TabsTrigger>
          <TabsTrigger value="team">Команда</TabsTrigger>
          <TabsTrigger value="errors">Ошибки</TabsTrigger>
          <TabsTrigger value="actions">Действия</TabsTrigger>
        </TabsList>

        <TabsContent value="projects">
          <Card className="mt-4">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Проект</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Клиенты</TableHead>
                    <TableHead>Рассылки</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects?.map((p) => (
                    <TableRow key={p.id} className="cursor-pointer">
                      <TableCell className="font-medium">
                        <Link href={`/companies/${id}/projects/${p.id}`} className="hover:underline">
                          {p.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{p.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">{p._count?.clients ?? '—'}</TableCell>
                      <TableCell className="text-xs text-gray-500">{p._count?.pushes ?? '—'}</TableCell>
                      <TableCell>
                        <Link href={`/companies/${id}/projects/${p.id}`}>
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {projects && projects.length === 0 && <p className="p-4 text-sm text-gray-400">Проектов нет</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="landings">
          <Card className="mt-4">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Лендинг</TableHead>
                    <TableHead>Проект</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Клиенты</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {landings?.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">{l.name}</TableCell>
                      <TableCell className="text-xs text-gray-500">{l.project.name}</TableCell>
                      <TableCell>
                        <Badge variant={l.status === 'PUBLISHED' ? 'outline' : 'secondary'}>
                          {l.status === 'PUBLISHED' ? 'Опубликован' : l.status === 'ARCHIVED' ? 'В архиве' : 'Черновик'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">{l._count?.clients ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => previewLanding(l.id)} title="Предпросмотр">
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {landings && landings.length === 0 && <p className="p-4 text-sm text-gray-400">Лендингов нет</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="domains">
          <Card className="mt-4">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Домен</TableHead>
                    <TableHead>Проект</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>SSL</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains?.map((d) => (
                    <DomainRowItem key={d.id} companyId={id} domain={d} />
                  ))}
                </TableBody>
              </Table>
              {domains && domains.length === 0 && <p className="p-4 text-sm text-gray-400">Доменов нет</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team">
          <Card className="mt-4">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Сотрудник</TableHead>
                    <TableHead>Роль</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Последний вход</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team?.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="font-medium">
                          {t.firstName} {t.lastName ?? ''}
                        </div>
                        <div className="text-xs text-gray-400">{t.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{t.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={t.isActive ? 'outline' : 'destructive'}>{t.isActive ? 'Активен' : 'Заблокирован'}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {t.lastLoginAt ? format(new Date(t.lastLoginAt), 'd MMM yyyy HH:mm', { locale: ru }) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {team && team.length === 0 && <p className="p-4 text-sm text-gray-400">Команда пуста</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="errors">
          <Card className="mt-4">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Время</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Код</TableHead>
                    <TableHead>Сообщение</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {errors?.items.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs text-gray-500">{format(new Date(e.createdAt), 'd MMM HH:mm', { locale: ru })}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs">{e.route}</TableCell>
                      <TableCell>
                        <Badge variant="destructive">{e.statusCode}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[320px] truncate text-xs">{e.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {errors && errors.items.length === 0 && <p className="p-4 text-sm text-gray-400">Ошибок не зафиксировано</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="actions">
          <Card className="mt-4">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Время</TableHead>
                    <TableHead>Админ</TableHead>
                    <TableHead>Действие</TableHead>
                    <TableHead>Было</TableHead>
                    <TableHead>Стало</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {actions?.items.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs text-gray-500">{format(new Date(a.createdAt), 'd MMM HH:mm', { locale: ru })}</TableCell>
                      <TableCell className="text-xs">
                        {a.admin.firstName} {a.admin.lastName ?? ''}
                      </TableCell>
                      <TableCell className="text-xs">{a.action}</TableCell>
                      <TableCell className="text-xs text-gray-500">{JSON.stringify(a.previousValue)}</TableCell>
                      <TableCell className="text-xs text-gray-500">{JSON.stringify(a.newValue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {actions && actions.items.length === 0 && <p className="p-4 text-sm text-gray-400">Действий не зафиксировано</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Пополнение баланса (Фаза 4.3C, запрос пользователя 2026-07-19) — без верхней границы и
// подтверждающего шага (явный выбор пользователя, "без ограничений, как попросили"), только
// проверка на положительное число (та же, что и на бэкенде, TopUpBalanceDto).
function TopUpDialog({
  companyId,
  companyName,
  onClose,
  onSaved,
}: {
  companyId: string;
  companyName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');

  const mutation = useMutation({
    mutationFn: async () => api.post(`/admin/companies/${companyId}/balance/topup`, { amount: Number(amount) }),
    onSuccess: onSaved,
  });

  const parsedAmount = Number(amount);
  const isValid = amount !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Пополнить баланс «{companyName}»</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="topup-amount">Сумма, $</Label>
            <Input id="topup-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={!isValid || mutation.isPending}>
              {mutation.isPending ? 'Начисляем...' : 'Начислить'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Ограничения (Фаза 4.3D, запрос пользователя 2026-07-19) — три независимых переключателя,
// каждый шлёт частичный PATCH сразу при переключении (без отдельной кнопки "Сохранить" — тот
// же UX, что и у остальных булевых настроек в проекте, например isActive в /team).
function RestrictionsCard({ companyId, overview }: { companyId: string; overview: Overview }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (patch: Partial<Pick<Overview, 'pushesBlocked' | 'domainsBlocked' | 'isSuspended'>>) =>
      api.patch(`/admin/companies/${companyId}/restrictions`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-company-overview', companyId] });
      queryClient.invalidateQueries({ queryKey: ['admin-company-actions', companyId] });
    },
  });

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <ShieldAlert className="h-4 w-4" /> Ограничения
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="restrict-pushes" className="font-normal text-gray-600">
            Запретить рассылки
          </Label>
          <Switch
            id="restrict-pushes"
            checked={overview.pushesBlocked}
            onCheckedChange={(checked) => mutation.mutate({ pushesBlocked: checked })}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="restrict-domains" className="font-normal text-gray-600">
            Запретить создание доменов
          </Label>
          <Switch
            id="restrict-domains"
            checked={overview.domainsBlocked}
            onCheckedChange={(checked) => mutation.mutate({ domainsBlocked: checked })}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="restrict-suspend" className="font-normal text-gray-600">
            Заблокировать вход команды
          </Label>
          <Switch
            id="restrict-suspend"
            checked={overview.isSuspended}
            onCheckedChange={(checked) => mutation.mutate({ isSuspended: checked })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// Принудительное удаление домена (Фаза 4.3D) — с подтверждением через window.confirm (тот же
// нативный паттерн, что уже используется для удаления в остальном приложении — необратимое
// действие, домен глобально уникален по hostname, восстановить нельзя).
function DomainRowItem({ companyId, domain }: { companyId: string; domain: DomainRow }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => api.delete(`/admin/companies/${companyId}/domains/${domain.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-company-domains', companyId] });
      queryClient.invalidateQueries({ queryKey: ['admin-company-actions', companyId] });
    },
  });

  return (
    <TableRow>
      <TableCell className="font-medium">{domain.domain}</TableCell>
      <TableCell className="text-xs text-gray-500">{domain.project?.name ?? '—'}</TableCell>
      <TableCell>
        <Badge variant="outline">{domain.status}</Badge>
      </TableCell>
      <TableCell className="text-xs text-gray-500">{domain.sslStatus ?? '—'}</TableCell>
      <TableCell>
        <Button
          size="sm"
          variant="destructive"
          disabled={mutation.isPending}
          onClick={() => {
            if (window.confirm(`Удалить домен «${domain.domain}» безвозвратно?`)) mutation.mutate();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
