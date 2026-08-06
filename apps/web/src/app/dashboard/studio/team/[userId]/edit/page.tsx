'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ClientsVisibilityScopeSection,
  CreatableRole,
  CredRow,
  DomainsPermissionsSection,
  LandingsVisibilityScopeSection,
  ProjectChecklist,
  ProjectPermissionsEditor,
  ProjectSummary,
  ROLE_HINTS,
  TeamMember,
  buildPermissionsState,
  genPassword,
  usePermissionsForm,
} from '../../../../../(dashboard)/team/shared';
import { STUDIO_CARD, StudioLinkButton } from '../../../ui';

// Studio-версия страницы редактирования участника команды (запрос пользователя 2026-07-30:
// "добей остальные оставшиеся страницы") — логика 1:1 с классической.
export default function StudioEditTeamMemberPage() {
  const { userId } = useParams<{ userId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isOwner = currentUser?.role === 'OWNER' || currentUser?.role === 'SUPER_ADMIN';
  const isOperatorAdmin = currentUser?.role === 'OPERATOR_ADMIN';

  const { data: members, isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: async () => (await api.get<TeamMember[]>('/team')).data,
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });

  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const form = usePermissionsForm(isOperatorAdmin ? 'OPERATOR' : 'BUYER');

  // Редактирование данных сотрудника (запрос пользователя 2026-08-03) — см. тот же комментарий
  // в классической версии страницы.
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savedPassword, setSavedPassword] = useState<string | null>(null);

  const member = members?.find((m) => m.id === userId) ?? null;

  if (member && loadedFor !== member.id) {
    setIsActive(member.isActive);
    setEmail(member.email);
    setFirstName(member.firstName);
    setLastName(member.lastName || '');
    setNewPassword('');
    const { projectPermissions, domainsPermissions } = buildPermissionsState(member.permissions);
    form.load(
      member.role === 'OWNER' ? 'ADMIN' : (member.role as CreatableRole),
      member.projectAccess.map((pa) => pa.project.id),
      projectPermissions,
      domainsPermissions,
      member.landingsVisibilityScope,
      member.clientsVisibilityScope,
    );
    setLoadedFor(member.id);
  }

  const update = useMutation({
    mutationFn: () => {
      // Operator — проекты этой страницей больше не редактируются (см. тот же комментарий в
      // классической версии) — только через вкладку «Операторы».
      const justBecameOperator = form.role === 'OPERATOR' && member?.role !== 'OPERATOR';
      const projectIds =
        form.role === 'ADMIN' ? undefined : form.role === 'OPERATOR' ? (justBecameOperator ? [] : undefined) : form.projectIds;

      return api.patch(`/team/${userId}`, {
        role: form.role,
        isActive,
        projectIds,
        projectPermissions:
          form.role === 'ADMIN' || form.role === 'OPERATOR'
            ? undefined
            : form.projectIds.map((projectId) => ({ projectId, permissions: form.projectPermissions[projectId] ?? [] })),
        domainsPermissions: form.role === 'ADMIN' || form.role === 'OPERATOR' ? undefined : form.domainsPermissions,
        landingsVisibilityScope: form.role === 'ADMIN' || form.role === 'OPERATOR' ? undefined : form.landingsVisibilityScope,
        clientsVisibilityScope: form.role === 'BUYER' ? form.clientsVisibilityScope : undefined,
        email,
        firstName,
        lastName: lastName || undefined,
        password: newPassword || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team'] });
      if (newPassword) {
        setSavedPassword(newPassword);
      } else {
        router.push('/team');
      }
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить изменения'),
  });

  if (savedPassword) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Пароль изменён</h1>
        <div className={`${STUDIO_CARD} p-5 space-y-3`}>
          <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
            Пароль показывается один раз — передайте его участнику лично, он больше нигде не сохранён.
          </p>
          <CredRow label="Новый пароль" value={savedPassword} />
          <StudioLinkButton variant="primary" onClick={() => router.push('/team')}>
            К списку команды
          </StudioLinkButton>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>;
  }

  if (!member) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Участник не найден.</p>
        <StudioLinkButton icon={ArrowLeft} onClick={() => router.push('/team')}>
          К списку команды
        </StudioLinkButton>
      </div>
    );
  }

  const needsProjects = form.role !== 'ADMIN' && form.role !== 'OPERATOR';
  const isOwnerRow = member.role === 'OWNER';

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => router.push('/team')} className="text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">
          {member.firstName} {member.lastName || ''}
        </h1>
      </div>

      {isOwnerRow ? (
        <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Владельца компании изменить нельзя.</p>
      ) : (
        <>
          <div className={`${STUDIO_CARD} p-5 space-y-3 max-w-xl`}>
            <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Данные сотрудника</h2>
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
              <Label htmlFor="tm-pass">Новый пароль (пусто — не менять)</Label>
              <div className="flex gap-2">
                <Input id="tm-pass" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="font-mono" />
                <StudioLinkButton onClick={() => setNewPassword(genPassword())}>Сгенерировать</StudioLinkButton>
              </div>
            </div>
          </div>

          <div className={`${STUDIO_CARD} p-5 space-y-3 max-w-xl`}>
            <div className="space-y-1.5">
              <Label>Роль</Label>
              <Select value={form.role} onValueChange={(v) => v && form.setRole(v as CreatableRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isOperatorAdmin ? (
                    <SelectItem value="OPERATOR">Оператор</SelectItem>
                  ) : (
                    <>
                      {isOwner && <SelectItem value="ADMIN">Администратор</SelectItem>}
                      <SelectItem value="BUYER">Байер</SelectItem>
                      <SelectItem value="OPERATOR">Оператор</SelectItem>
                      <SelectItem value="OPERATOR_ADMIN">Оператор-админ</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">{ROLE_HINTS[form.role]}</p>
              {form.role === 'OPERATOR' && (
                <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] border border-[#DCE1E8] dark:border-[#232B38] rounded-lg p-2.5">
                  Проекты этого оператора назначаются на вкладке «Операторы» на странице
                  «Команда» или в настройках проекта — не здесь.
                </p>
              )}
            </div>
            <div className="flex items-center justify-between border border-[#DCE1E8] dark:border-white/10 rounded-lg px-3 py-2">
              <Label htmlFor="tm-active">Активен</Label>
              <Switch id="tm-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          {needsProjects && (
            <>
              <div className={`${STUDIO_CARD} p-5 space-y-2`}>
                <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Проекты</h2>
                <ProjectChecklist projects={projects || []} selected={form.projectIds} onToggle={form.toggleProject} />
              </div>

              <div className={`${STUDIO_CARD} p-5 space-y-2`}>
                <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Разрешения по проектам</h2>
                <ProjectPermissionsEditor
                  projects={projects || []}
                  projectIds={form.projectIds}
                  projectPermissions={form.projectPermissions}
                  onTogglePermission={form.toggleProjectPermission}
                  onCopyToAll={form.copyToAll}
                />
              </div>

              <div className={`${STUDIO_CARD} p-5 space-y-2`}>
                <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Домены</h2>
                <DomainsPermissionsSection selected={form.domainsPermissions} onToggle={form.toggleDomainsPermission} />
              </div>

              <div className={`${STUDIO_CARD} p-5 space-y-2`}>
                <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Видимость лендингов</h2>
                <LandingsVisibilityScopeSection value={form.landingsVisibilityScope} onChange={form.setLandingsVisibilityScope} />
              </div>

              {form.role === 'BUYER' && (
                <div className={`${STUDIO_CARD} p-5 space-y-2`}>
                  <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Видимость клиентов и статистики</h2>
                  <ClientsVisibilityScopeSection value={form.clientsVisibilityScope} onChange={form.setClientsVisibilityScope} />
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            <StudioLinkButton variant="primary" onClick={() => update.mutate()} disabled={(needsProjects && form.projectIds.length === 0) || update.isPending}>
              {update.isPending ? 'Сохраняем...' : 'Сохранить'}
            </StudioLinkButton>
            <StudioLinkButton onClick={() => router.push('/team')}>Отмена</StudioLinkButton>
          </div>
        </>
      )}
    </div>
  );
}
