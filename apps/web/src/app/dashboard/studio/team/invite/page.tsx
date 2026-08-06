'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Label } from '@/components/ui/label';
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
  usePermissionsForm,
} from '../../../../(dashboard)/team/shared';
import { STUDIO_CARD, StudioLinkButton } from '../../ui';

// Studio-версия страницы создания ссылки-приглашения (запрос пользователя 2026-07-30: "добей
// остальные оставшиеся страницы") — логика 1:1 с классической. ProjectChecklist/
// ProjectPermissionsEditor/DomainsPermissionsSection/usePermissionsForm переиспользованы без
// изменений из того же ../../../../(dashboard)/team/shared, что и классика — сложная матрица
// разрешений, форкать не стоит (тот же принцип, что у ClientsFilter/PaymentModal).
export default function StudioNewInvitePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isOwner = currentUser?.role === 'OWNER' || currentUser?.role === 'SUPER_ADMIN';
  const isOperatorAdmin = currentUser?.role === 'OPERATOR_ADMIN';

  const [error, setError] = useState('');
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const form = usePermissionsForm(isOperatorAdmin ? 'OPERATOR' : 'BUYER');

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ token: string }>('/team-invites', {
        role: form.role,
        // Operator — то же исключение, что и на /team/new (запрос пользователя 2026-07-31).
        projectIds: form.role === 'ADMIN' || form.role === 'OPERATOR' ? undefined : form.projectIds,
        projectPermissions:
          form.role === 'ADMIN' || form.role === 'OPERATOR'
            ? undefined
            : form.projectIds.map((projectId) => ({ projectId, permissions: form.projectPermissions[projectId] ?? [] })),
        domainsPermissions: form.role === 'ADMIN' || form.role === 'OPERATOR' ? undefined : form.domainsPermissions,
        landingsVisibilityScope: form.role === 'ADMIN' || form.role === 'OPERATOR' ? undefined : form.landingsVisibilityScope,
        clientsVisibilityScope: form.role === 'BUYER' ? form.clientsVisibilityScope : undefined,
      }),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['team-invites'] });
      setCreatedUrl(`${window.location.origin}/invite/${data.token}`);
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать ссылку'),
  });

  const needsProjects = form.role !== 'ADMIN' && form.role !== 'OPERATOR';
  const canSubmit = !needsProjects || form.projectIds.length > 0;

  if (createdUrl) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Ссылка-приглашение готова</h1>
        <div className={`${STUDIO_CARD} p-5 space-y-3`}>
          <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
            Действует 7 дней и одноразовая — после перехода и регистрации ссылка становится
            недействительной. Отправьте её приглашённому любым удобным способом.
          </p>
          <CredRow label="Ссылка" value={createdUrl} />
          <StudioLinkButton variant="primary" onClick={() => router.push('/team')}>
            К списку команды
          </StudioLinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => router.push('/team')} className="text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Ссылка-приглашение</h1>
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
              Проекты назначаются отдельно — через вкладку «Операторы» в настройках проекта или
              карточку оператора в разделе «Операторы» на странице «Команда».
            </p>
          )}
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
        <StudioLinkButton variant="primary" onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}>
          {create.isPending ? 'Создаём...' : 'Создать ссылку'}
        </StudioLinkButton>
        <StudioLinkButton onClick={() => router.push('/team')}>Отмена</StudioLinkButton>
      </div>
    </div>
  );
}
