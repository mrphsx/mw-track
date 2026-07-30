'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CreatableRole,
  DomainsPermissionsSection,
  ProjectChecklist,
  ProjectPermissionsEditor,
  ProjectSummary,
  ROLE_HINTS,
  TeamMember,
  buildPermissionsState,
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
  const form = usePermissionsForm('BUYER');

  const member = members?.find((m) => m.id === userId) ?? null;

  if (member && loadedFor !== member.id) {
    setIsActive(member.isActive);
    const { projectPermissions, domainsPermissions } = buildPermissionsState(member.permissions);
    form.load(
      member.role === 'OWNER' ? 'ADMIN' : (member.role as CreatableRole),
      member.projectAccess.map((pa) => pa.project.id),
      projectPermissions,
      domainsPermissions,
    );
    setLoadedFor(member.id);
  }

  const update = useMutation({
    mutationFn: () =>
      api.patch(`/team/${userId}`, {
        role: form.role,
        isActive,
        projectIds: form.role === 'ADMIN' ? undefined : form.projectIds,
        projectPermissions:
          form.role === 'ADMIN'
            ? undefined
            : form.projectIds.map((projectId) => ({ projectId, permissions: form.projectPermissions[projectId] ?? [] })),
        domainsPermissions: form.role === 'ADMIN' ? undefined : form.domainsPermissions,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team'] });
      router.push('/dashboard/studio/team');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить изменения'),
  });

  if (isLoading) {
    return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>;
  }

  if (!member) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Участник не найден.</p>
        <StudioLinkButton icon={ArrowLeft} onClick={() => router.push('/dashboard/studio/team')}>
          К списку команды
        </StudioLinkButton>
      </div>
    );
  }

  const needsProjects = form.role !== 'ADMIN';
  const isOwnerRow = member.role === 'OWNER';

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => router.push('/dashboard/studio/team')} className="text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]">
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
            <div className="space-y-1.5">
              <Label>Роль</Label>
              <Select value={form.role} onValueChange={(v) => v && form.setRole(v as CreatableRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isOwner && <SelectItem value="ADMIN">Администратор</SelectItem>}
                  <SelectItem value="BUYER">Байер</SelectItem>
                  <SelectItem value="OPERATOR">Оператор</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">{ROLE_HINTS[form.role]}</p>
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
            </>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            <StudioLinkButton variant="primary" onClick={() => update.mutate()} disabled={(needsProjects && form.projectIds.length === 0) || update.isPending}>
              {update.isPending ? 'Сохраняем...' : 'Сохранить'}
            </StudioLinkButton>
            <StudioLinkButton onClick={() => router.push('/dashboard/studio/team')}>Отмена</StudioLinkButton>
          </div>
        </>
      )}
    </div>
  );
}
