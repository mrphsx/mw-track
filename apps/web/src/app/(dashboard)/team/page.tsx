'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InviteLinkCell, ROLE_LABELS, TeamInvite, TeamMember } from './shared';

export default function TeamPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const { data: members, isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: async () => (await api.get<TeamMember[]>('/team')).data,
  });

  const { data: invites } = useQuery({
    queryKey: ['team-invites'],
    queryFn: async () => (await api.get<TeamInvite[]>('/team-invites')).data,
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
          <Button variant="outline" nativeButton={false} render={
            <Link href="/team/invite">
              <Link2 className="w-4 h-4 mr-1.5" /> Пригласить по ссылке
            </Link>
          } />
          <Button nativeButton={false} render={
            <Link href="/team/new">
              <Plus className="w-4 h-4 mr-1.5" /> Добавить участника
            </Link>
          } />
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
                      {m.id === currentUser?.id ? (
                        <div>
                          <div className="font-medium">
                            {m.firstName} {m.lastName || ''}
                          </div>
                          <div className="text-xs text-muted-foreground">{m.email}</div>
                        </div>
                      ) : (
                        <Link href={`/team/${m.id}/edit`} className="hover:underline">
                          <div className="font-medium">
                            {m.firstName} {m.lastName || ''}
                          </div>
                          <div className="text-xs text-muted-foreground">{m.email}</div>
                        </Link>
                      )}
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
                        <Button
                          size="sm"
                          variant="outline"
                          nativeButton={false}
                          disabled={m.id === currentUser?.id}
                          render={<Link href={`/team/${m.id}/edit`}>Изменить</Link>}
                        />
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
  role: TeamMember['role'];
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
