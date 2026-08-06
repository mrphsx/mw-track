'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
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
} from '../shared';

// Отдельная страница вместо диалога (запрос пользователя 2026-07-28) — та же причина, что
// и у /team/new: per-project матрица прав не помещалась в узкое модальное окно.
export default function NewInvitePage() {
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
        <h1 className="text-2xl font-bold">Ссылка-приглашение готова</h1>
        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm text-muted-foreground">
              Действует 7 дней и одноразовая — после перехода и регистрации ссылка становится
              недействительной. Отправьте её приглашённому любым удобным способом.
            </p>
            <CredRow label="Ссылка" value={createdUrl} />
            <Button onClick={() => router.push('/team')}>К списку команды</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/team')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-2xl font-bold">Ссылка-приглашение</h1>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3 max-w-xl">
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
            <p className="text-xs text-muted-foreground">{ROLE_HINTS[form.role]}</p>
            {form.role === 'OPERATOR' && (
              <p className="text-xs text-muted-foreground border rounded-md p-2.5 bg-muted/40">
                Проекты назначаются отдельно — через вкладку «Операторы» в настройках проекта
                или карточку оператора в разделе «Операторы» на странице «Команда».
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {needsProjects && (
        <>
          <Card>
            <CardContent className="pt-6 space-y-2">
              <h2 className="text-sm font-semibold">Проекты</h2>
              <ProjectChecklist projects={projects || []} selected={form.projectIds} onToggle={form.toggleProject} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-2">
              <h2 className="text-sm font-semibold">Разрешения по проектам</h2>
              <ProjectPermissionsEditor
                projects={projects || []}
                projectIds={form.projectIds}
                projectPermissions={form.projectPermissions}
                onTogglePermission={form.toggleProjectPermission}
                onCopyToAll={form.copyToAll}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-2">
              <h2 className="text-sm font-semibold">Домены</h2>
              <DomainsPermissionsSection selected={form.domainsPermissions} onToggle={form.toggleDomainsPermission} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-2">
              <h2 className="text-sm font-semibold">Видимость лендингов</h2>
              <LandingsVisibilityScopeSection value={form.landingsVisibilityScope} onChange={form.setLandingsVisibilityScope} />
            </CardContent>
          </Card>

          {form.role === 'BUYER' && (
            <Card>
              <CardContent className="pt-6 space-y-2">
                <h2 className="text-sm font-semibold">Видимость клиентов и статистики</h2>
                <ClientsVisibilityScopeSection value={form.clientsVisibilityScope} onChange={form.setClientsVisibilityScope} />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}>
          {create.isPending ? 'Создаём...' : 'Создать ссылку'}
        </Button>
        <Button variant="outline" onClick={() => router.push('/team')}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
