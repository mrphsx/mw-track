'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { AssignOperatorProjectsDialog, InviteLinkCell, ProjectSummary, ROLE_LABELS, TeamInvite, TeamMember } from '../../../(dashboard)/team/shared';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../ui';

// Studio-версия страницы команды (запрос пользователя 2026-07-30: "готовить все остальные
// страницы") — логика 1:1 с классической (apps/web/.../(dashboard)/team/page.tsx). InviteLinkCell/
// ROLE_LABELS/типы переиспользованы из того же ./shared, что и классика (маленький готовый
// виджет, не форкается). Приглашение/добавление/редактирование участника (2026-07-30, "добей
// остальные оставшиеся страницы") тоже получили Studio-версии — dashboard/studio/team/invite|new|
// [userId]/edit.
export default function StudioTeamPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [assigningOperator, setAssigningOperator] = useState<TeamMember | null>(null);
  // Свой пилюльный переключатель вместо общего <Tabs> (запрос пользователя 2026-07-31: "не под
  // наш дизайн, цвета другие") — тот же паттерн, что уже используется в настройках проекта
  // Studio (projects/[id]/settings/page.tsx): inline-flex с p-1/gap-0.5, активная пилюля —
  // фирменный синий Cobalt Field (#1F4E9C/#7BA9EE), не нейтральный shadcn `bg-muted`.
  const [tab, setTab] = useState<'team' | 'operators'>('team');

  const { data: members, isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: async () => (await api.get<TeamMember[]>('/team')).data,
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
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
  // Операторы — отдельная вкладка (запрос пользователя 2026-07-31), см. тот же комментарий в
  // классической версии.
  const otherMembers = members?.filter((m) => m.role !== 'OPERATOR');
  const operators = members?.filter((m) => m.role === 'OPERATOR');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Команда</h1>
        <div className="flex gap-2">
          <StudioLinkButton icon={Link2} href="/team/invite">
            Пригласить по ссылке
          </StudioLinkButton>
          <StudioLinkButton variant="primary" icon={Plus} href="/team/new">
            Добавить участника
          </StudioLinkButton>
        </div>
      </div>

      <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
        Роли: Admin — полный доступ, кроме биллинга. Buyer — лендинги/канал/пуши только своих
        проектов. Operator — клиенты/депозиты только своих проектов. Приглашений по почте пока нет —
        создайте аккаунт сами, либо сгенерируйте ссылку-приглашение (действует 7 дней, одноразовая) —
        человек сам заведёт себе пароль по ней.
      </p>

      {isLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {!isLoading && (
        <>
          <div className="inline-flex flex-wrap rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-1 gap-0.5">
            {(
              [
                { value: 'team' as const, label: 'Команда' },
                { value: 'operators' as const, label: `Операторы${operators?.length ? ` (${operators.length})` : ''}` },
              ]
            ).map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={`px-4 py-1.5 text-sm rounded-lg transition-colors whitespace-nowrap ${
                  tab === t.value
                    ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                    : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'team' && (
            <div className="space-y-6">
            {!!pendingInvites?.length && (
              <div className={`${STUDIO_CARD} overflow-x-auto`}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                      <th className="px-5 py-3 font-medium">Ссылка-приглашение</th>
                      <th className="px-5 py-3 font-medium">Роль</th>
                      <th className="px-5 py-3 font-medium">Действует до</th>
                      <th className="px-5 py-3 font-medium text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
                    {pendingInvites.map((inv) => (
                      <tr key={inv.id}>
                        <td className="px-5 py-3">
                          <InviteLinkCell token={inv.token} />
                        </td>
                        <td className="px-5 py-3">
                          <StudioPill hue="slate">{ROLE_LABELS[inv.role]}</StudioPill>
                        </td>
                        <td className="px-5 py-3 text-[#5F6B7A] dark:text-[#92A0AF]">{new Date(inv.expiresAt).toLocaleDateString('ru-RU')}</td>
                        <td className="px-5 py-3 text-right">
                          <button
                            type="button"
                            disabled={revokeInvite.isPending}
                            onClick={() => {
                              if (confirm('Отозвать эту ссылку-приглашение?')) revokeInvite.mutate(inv.id);
                            }}
                            className="text-[#5F6B7A] dark:text-[#92A0AF] hover:text-red-600 dark:hover:text-red-400"
                          >
                            <Trash2 className="w-4 h-4 inline" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!!otherMembers?.length && (
              <div className={`${STUDIO_CARD} overflow-x-auto`}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                      <th className="px-5 py-3 font-medium">Участник</th>
                      <th className="px-5 py-3 font-medium">Роль</th>
                      <th className="px-5 py-3 font-medium">Проекты</th>
                      <th className="px-5 py-3 font-medium">Статус</th>
                      <th className="px-5 py-3 font-medium">Последний вход</th>
                      <th className="px-5 py-3 font-medium text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
                    {otherMembers.map((m) => (
                      <tr key={m.id}>
                        <td className="px-5 py-3">
                          {m.id === currentUser?.id ? (
                            <div>
                              <div className="font-medium text-[#131A24] dark:text-[#E9EDF3]">
                                {m.firstName} {m.lastName || ''}
                              </div>
                              <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">{m.email}</div>
                            </div>
                          ) : (
                            <Link href={`/team/${m.id}/edit`} className="hover:underline">
                              <div className="font-medium text-[#131A24] dark:text-[#E9EDF3]">
                                {m.firstName} {m.lastName || ''}
                              </div>
                              <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">{m.email}</div>
                            </Link>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <StudioPill hue="slate">{ROLE_LABELS[m.role]}</StudioPill>
                        </td>
                        <td className="px-5 py-3">
                          {m.role === 'OWNER' || m.role === 'ADMIN' ? (
                            <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Все проекты</span>
                          ) : m.projectAccess.length === 0 ? (
                            <span className="text-xs text-[#B23A1E] dark:text-[#F0855E]">Нет доступных проектов</span>
                          ) : (
                            <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">{m.projectAccess.map((pa) => pa.project.name).join(', ')}</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {m.isActive ? <StudioPill hue="sage">Активен</StudioPill> : <StudioPill hue="slate">Отключён</StudioPill>}
                        </td>
                        <td className="px-5 py-3 text-[#5F6B7A] dark:text-[#92A0AF]">{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString('ru-RU') : '—'}</td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end items-center gap-3">
                            <StudioLinkButton size="sm" disabled={m.id === currentUser?.id} href={`/team/${m.id}/edit`}>
                              Изменить
                            </StudioLinkButton>
                            {m.role !== 'OWNER' && m.isActive && (
                              <button
                                type="button"
                                disabled={m.id === currentUser?.id || removeMember.isPending}
                                onClick={() => {
                                  if (confirm(`Отключить доступ участнику ${m.email}?`)) removeMember.mutate(m.id);
                                }}
                                className="text-[#5F6B7A] dark:text-[#92A0AF] hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          )}

          {tab === 'operators' && (
            <div className="space-y-4">
            <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
              Операторы больше не получают проекты при создании — доступ выдаётся здесь (кнопка
              «Проекты» на карточке) или на вкладке «Операторы» в настройках самого проекта.
            </p>
            {!operators?.length ? (
              <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Операторов пока нет.</p>
            ) : (
              <div className={`${STUDIO_CARD} overflow-x-auto`}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                      <th className="px-5 py-3 font-medium">Участник</th>
                      <th className="px-5 py-3 font-medium">Проекты</th>
                      <th className="px-5 py-3 font-medium">Статус</th>
                      <th className="px-5 py-3 font-medium">Последний вход</th>
                      <th className="px-5 py-3 font-medium text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
                    {operators.map((m) => (
                      <tr key={m.id}>
                        <td className="px-5 py-3">
                          <div className="font-medium text-[#131A24] dark:text-[#E9EDF3]">
                            {m.firstName} {m.lastName || ''}
                          </div>
                          <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">{m.email}</div>
                        </td>
                        <td className="px-5 py-3">
                          {m.projectAccess.length === 0 ? (
                            <span className="text-xs text-[#B23A1E] dark:text-[#F0855E]">Нет доступных проектов</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {m.projectAccess.map((pa) => (
                                <StudioPill key={pa.project.id} hue="slate">
                                  {pa.project.name}
                                </StudioPill>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {m.isActive ? <StudioPill hue="sage">Активен</StudioPill> : <StudioPill hue="slate">Отключён</StudioPill>}
                        </td>
                        <td className="px-5 py-3 text-[#5F6B7A] dark:text-[#92A0AF]">{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString('ru-RU') : '—'}</td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end items-center gap-3">
                            <StudioLinkButton size="sm" onClick={() => setAssigningOperator(m)}>
                              Проекты
                            </StudioLinkButton>
                            <StudioLinkButton size="sm" href={`/team/${m.id}/edit`}>
                              Изменить
                            </StudioLinkButton>
                            {m.isActive && (
                              <button
                                type="button"
                                disabled={removeMember.isPending}
                                onClick={() => {
                                  if (confirm(`Отключить доступ оператору ${m.email}?`)) removeMember.mutate(m.id);
                                }}
                                className="text-[#5F6B7A] dark:text-[#92A0AF] hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          )}
        </>
      )}

      <AssignOperatorProjectsDialog operator={assigningOperator} projects={projects || []} onClose={() => setAssigningOperator(null)} />

      <TeamAnalyticsSection />
    </div>
  );
}

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
        <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-3">Статистика по рекламщикам</h2>
        <div className={`${STUDIO_CARD} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                <th className="px-5 py-3 font-medium">Имя</th>
                <th className="px-5 py-3 font-medium">Роль</th>
                <th className="px-5 py-3 font-medium text-right">Клиентов</th>
                <th className="px-5 py-3 font-medium text-right">Выручка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
              {buyerStats?.buyers.map((b) => (
                <tr key={b.userId}>
                  <td className="px-5 py-3 font-medium text-[#131A24] dark:text-[#E9EDF3]">{b.name}</td>
                  <td className="px-5 py-3 text-[#5F6B7A] dark:text-[#92A0AF]">{ROLE_LABELS[b.role]}</td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{b.clients}</td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{formatMoney(b.revenue)}</td>
                </tr>
              ))}
              {buyerStats && (
                <tr>
                  <td className="px-5 py-3 font-medium text-[#5F6B7A] dark:text-[#92A0AF]" colSpan={2}>
                    БЕЗ БАЕРА
                  </td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{buyerStats.unattributed.clients}</td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{formatMoney(buyerStats.unattributed.revenue)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-3">Сравнение проектов</h2>
        <div className={`${STUDIO_CARD} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                <th className="px-5 py-3 font-medium">Проект</th>
                <th className="px-5 py-3 font-medium text-right">Клиентов всего</th>
                <th className="px-5 py-3 font-medium text-right">Новых за 30 дней</th>
                <th className="px-5 py-3 font-medium text-right">Выручка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
              {projectStats?.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3 font-medium text-[#131A24] dark:text-[#E9EDF3]">{p.name}</td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{p.totalClients}</td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{p.newClients}</td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{formatMoney(p.totalRevenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
