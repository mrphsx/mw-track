'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Check, Copy } from 'lucide-react';
import { copyToClipboard } from '@/lib/utils';
import { DEFAULT_ROLE_PERMISSIONS, DOMAINS_PERMISSION_GROUP, PERMISSION_GROUPS, Permission, splitPermissionsByScope } from '@/lib/permissions';

export type TeamRole = 'OWNER' | 'ADMIN' | 'BUYER' | 'OPERATOR';
export type CreatableRole = 'ADMIN' | 'BUYER' | 'OPERATOR';

export interface ProjectSummary {
  id: string;
  name: string;
}

export interface TeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  role: TeamRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  projectAccess: { project: { id: string; name: string } }[];
  // Per-project (запрос пользователя 2026-07-28) — DOMAINS_* тоже хранятся с projectId
  // (реплицируются на каждый проект пользователя), но трактуются как общее право, см.
  // buildPermissionsState ниже.
  permissions: { projectId: string; permission: Permission }[];
}

export interface TeamInvite {
  id: string;
  token: string;
  role: CreatableRole;
  projectIds: string[] | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export const ROLE_LABELS: Record<TeamRole, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  BUYER: 'Байер',
  OPERATOR: 'Оператор',
};

export const ROLE_HINTS: Record<CreatableRole, string> = {
  ADMIN: 'Полный доступ ко всем проектам и команде компании, кроме биллинга.',
  BUYER: 'Лендинги, канал/бот, пуши и статистика — только выбранных проектов.',
  OPERATOR: 'Клиенты и депозиты — только выбранных проектов.',
};

export function genPassword(): string {
  return Math.random().toString(36).slice(-5) + Math.random().toString(36).slice(-5).toUpperCase() + '!1';
}

// Разворачивает плоский список { projectId, permission } (пришедший от бэкенда, где
// DOMAINS_* реплицированы на каждый проект) обратно в форму для формы редактирования:
// per-project матрица + один общий набор доменных прав (дедуп по значению, т.к. одно и то же
// DOMAINS_* право лежит на каждом проекте одинаково).
export function buildPermissionsState(permissions: TeamMember['permissions']): {
  projectPermissions: Record<string, Permission[]>;
  domainsPermissions: Permission[];
} {
  const projectPermissions: Record<string, Permission[]> = {};
  const domainsPermissions = new Set<Permission>();
  for (const p of permissions) {
    const { projectPermissions: proj, domainsPermissions: dom } = splitPermissionsByScope([p.permission]);
    if (dom.length) domainsPermissions.add(p.permission);
    if (proj.length) (projectPermissions[p.projectId] ??= []).push(p.permission);
  }
  return { projectPermissions, domainsPermissions: Array.from(domainsPermissions) };
}

// Общее состояние формы для создания/приглашения/редактирования — per-project матрица +
// отдельный общий блок доменов, вынесено в один хук, чтобы не тройной раз дублировать одну и
// ту же логику toggle/copy/reset (запрос пользователя 2026-07-28, per-project редизайн).
export function usePermissionsForm(initialRole: CreatableRole) {
  const [role, setRoleState] = useState<CreatableRole>(initialRole);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [projectPermissions, setProjectPermissions] = useState<Record<string, Permission[]>>({});
  const [domainsPermissions, setDomainsPermissions] = useState<Permission[]>([]);

  const setRole = (r: CreatableRole) => {
    setRoleState(r);
    const { projectPermissions: proj, domainsPermissions: dom } = splitPermissionsByScope(DEFAULT_ROLE_PERMISSIONS[r] ?? []);
    const next: Record<string, Permission[]> = {};
    for (const id of projectIds) next[id] = proj;
    setProjectPermissions(next);
    setDomainsPermissions(dom);
  };

  const toggleProject = (id: string) => {
    if (projectIds.includes(id)) {
      setProjectIds((prev) => prev.filter((x) => x !== id));
      setProjectPermissions((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } else {
      setProjectIds((prev) => [...prev, id]);
      setProjectPermissions((prev) => ({
        ...prev,
        [id]: prev[id] ?? splitPermissionsByScope(DEFAULT_ROLE_PERMISSIONS[role] ?? []).projectPermissions,
      }));
    }
  };

  const toggleProjectPermission = (projectId: string, p: Permission) => {
    setProjectPermissions((prev) => {
      const current = prev[projectId] ?? [];
      return { ...prev, [projectId]: current.includes(p) ? current.filter((x) => x !== p) : [...current, p] };
    });
  };

  const toggleDomainsPermission = (p: Permission) => {
    setDomainsPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const copyToAll = (fromProjectId: string) => {
    setProjectPermissions((prev) => {
      const source = prev[fromProjectId] ?? [];
      const next = { ...prev };
      for (const id of projectIds) next[id] = source;
      return next;
    });
  };

  const reset = () => {
    setRoleState(initialRole);
    setProjectIds([]);
    setProjectPermissions({});
    setDomainsPermissions([]);
  };

  const load = (r: CreatableRole, ids: string[], projPerms: Record<string, Permission[]>, domPerms: Permission[]) => {
    setRoleState(r);
    setProjectIds(ids);
    setProjectPermissions(projPerms);
    setDomainsPermissions(domPerms);
  };

  return {
    role,
    setRole,
    projectIds,
    toggleProject,
    projectPermissions,
    toggleProjectPermission,
    domainsPermissions,
    toggleDomainsPermission,
    copyToAll,
    reset,
    load,
  };
}

export function InviteLinkCell({ token }: { token: string }) {
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

export function CredRow({ label, value }: { label: string; value: string }) {
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

export function ProjectChecklist({
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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 max-h-64 overflow-y-auto border rounded-md p-3">
      {projects.map((p) => (
        <label key={p.id} className="flex items-center gap-1.5 text-sm">
          <Checkbox checked={selected.includes(p.id)} onCheckedChange={() => onToggle(p.id)} />
          <span className="truncate">{p.name}</span>
        </label>
      ))}
    </div>
  );
}

// Матрица прав (запрос пользователя 2026-07-17: "кто что может делать, удалять, создавать,
// менять лэндинги, пиксели, домены, пуши итд") — сгруппирована по ресурсу. groups —
// PERMISSION_GROUPS (per-project) или [DOMAINS_PERMISSION_GROUP] (общий блок, см. ниже).
// Без ограничения высоты/скролла (запрос пользователя 2026-07-28: "разрешения не помещаются
// на экран... не видно все разрешения") — теперь живёт на полноразмерной странице, а не в
// узком диалоге, скроллится вместе со страницей целиком.
function PermissionMatrix({
  groups,
  selected,
  onToggle,
}: {
  groups: { label: string; permissions: { value: Permission; label: string }[] }[];
  selected: Permission[];
  onToggle: (p: Permission) => void;
}) {
  return (
    <div className="space-y-3 border rounded-md p-3">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="text-xs font-medium text-muted-foreground mb-1">{group.label}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
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

// Per-project часть (запрос пользователя 2026-07-28: "чтобы под каждый проект можно было
// выбрать разрешения а не общие") — под каждым отмеченным в ProjectChecklist проектом своя
// PermissionMatrix. "Скопировать на все" — иначе для сотрудника с 5+ проектами пришлось бы
// тыкать одно и то же 5 раз вручную.
export function ProjectPermissionsEditor({
  projects,
  projectIds,
  projectPermissions,
  onTogglePermission,
  onCopyToAll,
}: {
  projects: ProjectSummary[];
  projectIds: string[];
  projectPermissions: Record<string, Permission[]>;
  onTogglePermission: (projectId: string, p: Permission) => void;
  onCopyToAll: (fromProjectId: string) => void;
}) {
  if (projectIds.length === 0) {
    return <p className="text-xs text-muted-foreground">Сначала выберите проекты выше.</p>;
  }
  return (
    <div className="space-y-4">
      {projectIds.map((projectId) => {
        const project = projects.find((p) => p.id === projectId);
        return (
          <div key={projectId} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{project?.name || projectId}</div>
              {projectIds.length > 1 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={() => onCopyToAll(projectId)}
                >
                  Скопировать на все проекты
                </button>
              )}
            </div>
            <PermissionMatrix
              groups={PERMISSION_GROUPS}
              selected={projectPermissions[projectId] ?? []}
              onToggle={(p) => onTogglePermission(projectId, p)}
            />
          </div>
        );
      })}
    </div>
  );
}

// Общий блок доменных прав (решение пользователя 2026-07-28: домены не привязаны к одному
// проекту, остаются общим правом роли/сотрудника) — рендерится один раз, отдельно от
// per-project части, не дублируется под каждым проектом.
export function DomainsPermissionsSection({ selected, onToggle }: { selected: Permission[]; onToggle: (p: Permission) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">Общее право для сотрудника — не привязано к конкретному проекту.</p>
      <PermissionMatrix groups={[DOMAINS_PERMISSION_GROUP]} selected={selected} onToggle={onToggle} />
    </div>
  );
}
