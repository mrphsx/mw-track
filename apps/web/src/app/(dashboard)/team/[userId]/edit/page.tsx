'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
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
} from '../../shared';

// Отдельная страница вместо диалога (запрос пользователя 2026-07-28). Нет отдельного
// GET /team/:userId на бэкенде — участник ищется в уже загруженном списке GET /team (тот же
// React Query кэш, что и на /team), лишний эндпоинт не понадобился.
export default function EditTeamMemberPage() {
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
      router.push('/team');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить изменения'),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка...</p>;
  }

  if (!member) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Участник не найден.</p>
        <Button variant="outline" onClick={() => router.push('/team')}>
          <ArrowLeft className="w-4 h-4 mr-1.5" /> К списку команды
        </Button>
      </div>
    );
  }

  const needsProjects = form.role !== 'ADMIN';
  const isOwnerRow = member.role === 'OWNER';

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/team')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-2xl font-bold">
          {member.firstName} {member.lastName || ''}
        </h1>
      </div>

      {isOwnerRow ? (
        <p className="text-sm text-muted-foreground">Владельца компании изменить нельзя.</p>
      ) : (
        <>
          <Card>
            <CardContent className="pt-6 space-y-3 max-w-xl">
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
                <p className="text-xs text-muted-foreground">{ROLE_HINTS[form.role]}</p>
              </div>
              <div className="flex items-center justify-between border rounded-md px-3 py-2">
                <Label htmlFor="tm-active">Активен</Label>
                <Switch id="tm-active" checked={isActive} onCheckedChange={setIsActive} />
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
            </>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={() => update.mutate()} disabled={(needsProjects && form.projectIds.length === 0) || update.isPending}>
              {update.isPending ? 'Сохраняем...' : 'Сохранить'}
            </Button>
            <Button variant="outline" onClick={() => router.push('/team')}>
              Отмена
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
