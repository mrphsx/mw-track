'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Input } from '@/components/ui/input';
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
  genPassword,
  usePermissionsForm,
} from '../../../../(dashboard)/team/shared';
import { STUDIO_CARD, StudioLinkButton } from '../../ui';

// Studio-версия страницы добавления участника команды (запрос пользователя 2026-07-30: "добей
// остальные оставшиеся страницы") — логика 1:1 с классической. ProjectChecklist/
// ProjectPermissionsEditor/DomainsPermissionsSection/usePermissionsForm переиспользованы без
// изменений, тот же принцип, что и на Studio-странице приглашения по ссылке.
export default function StudioNewTeamMemberPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isOwner = currentUser?.role === 'OWNER' || currentUser?.role === 'SUPER_ADMIN';
  const isOperatorAdmin = currentUser?.role === 'OPERATOR_ADMIN';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(genPassword());
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState('');
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string } | null>(null);
  const form = usePermissionsForm(isOperatorAdmin ? 'OPERATOR' : 'BUYER');

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/team', {
        email,
        password,
        firstName,
        lastName: lastName || undefined,
        role: form.role,
        // Operator — без проектов/прав даже если форма их не показывает (запрос
        // пользователя 2026-07-31: доступ выдаётся отдельно после создания).
        projectIds: form.role === 'ADMIN' || form.role === 'OPERATOR' ? undefined : form.projectIds,
        projectPermissions:
          form.role === 'ADMIN' || form.role === 'OPERATOR'
            ? undefined
            : form.projectIds.map((projectId) => ({ projectId, permissions: form.projectPermissions[projectId] ?? [] })),
        domainsPermissions: form.role === 'ADMIN' || form.role === 'OPERATOR' ? undefined : form.domainsPermissions,
        landingsVisibilityScope: form.role === 'ADMIN' || form.role === 'OPERATOR' ? undefined : form.landingsVisibilityScope,
        clientsVisibilityScope: form.role === 'BUYER' ? form.clientsVisibilityScope : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team'] });
      setCreatedCreds({ email, password });
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать участника'),
  });

  const needsProjects = form.role !== 'ADMIN' && form.role !== 'OPERATOR';
  const canSubmit = email && password.length >= 8 && firstName && (!needsProjects || form.projectIds.length > 0);

  if (createdCreds) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Участник создан</h1>
        <div className={`${STUDIO_CARD} p-5 space-y-3`}>
          <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Пароль показывается один раз — передайте его участнику лично, он больше нигде не сохранён.</p>
          <CredRow label="Email" value={createdCreds.email} />
          <CredRow label="Пароль" value={createdCreds.password} />
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
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Новый участник</h1>
      </div>

      <div className={`${STUDIO_CARD} p-5 space-y-3 max-w-xl`}>
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
            <StudioLinkButton onClick={() => setPassword(genPassword())}>Сгенерировать</StudioLinkButton>
          </div>
        </div>
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
          {create.isPending ? 'Создаём...' : 'Создать'}
        </StudioLinkButton>
        <StudioLinkButton onClick={() => router.push('/team')}>Отмена</StudioLinkButton>
      </div>
    </div>
  );
}
