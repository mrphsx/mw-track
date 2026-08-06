import { User } from '@/store/auth.store';

// Зеркалит backend enum Permission (prisma/schema.prisma) — тот же паттерн дублирования
// типов, что уже есть для других enum'ов на фронте (запрос пользователя 2026-07-17:
// "гранулярные права команды").
export const PERMISSIONS = [
  'LANDINGS_VIEW',
  'LANDINGS_CREATE',
  'LANDINGS_EDIT',
  'LANDINGS_DELETE',
  'PIXELS_VIEW',
  'PIXELS_CREATE',
  'PIXELS_EDIT',
  'PIXELS_DELETE',
  'DOMAINS_VIEW',
  'DOMAINS_CREATE',
  'DOMAINS_EDIT',
  'DOMAINS_DELETE',
  'PUSHES_VIEW',
  'PUSHES_CREATE',
  'PUSHES_SEND',
  'PUSHES_DELETE',
  'AUTOMATIONS_VIEW',
  'AUTOMATIONS_CREATE',
  'AUTOMATIONS_EDIT',
  'AUTOMATIONS_DELETE',
  'AB_TESTS_VIEW',
  'AB_TESTS_CREATE',
  'AB_TESTS_EDIT',
  'AB_TESTS_DELETE',
  'CHANNEL_VIEW',
  'CHANNEL_MANAGE',
  'CLIENTS_VIEW',
  'CLIENTS_EDIT',
  'CLIENTS_DELETE',
  'CLIENTS_EXPORT',
  'CLIENTS_VIEW_CROSS_PROJECT',
  'STATS_VIEW',
  'STATS_VIEW_REVENUE',
  'STATS_VIEW_TEAM_LEADERBOARDS',
  'PROJECTS_EDIT',
  'PERSONAL_BROADCASTS_VIEW',
  'PERSONAL_BROADCASTS_CREATE',
  'PERSONAL_BROADCASTS_SEND',
  'PERSONAL_BROADCASTS_DELETE',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ELEVATED_ROLES = ['OWNER', 'ADMIN', 'SUPER_ADMIN'];

// Права per-project (запрос пользователя 2026-07-28) — нужен конкретный projectId. Elevated
// роли (OWNER/ADMIN/SUPER_ADMIN) всегда полный доступ, не проверяются по списку — зеркалит
// backend isElevatedRole/ProjectsService.assertAccess.
export function hasPermission(
  user: Pick<User, 'role' | 'permissionsByProject'> | null | undefined,
  projectId: string,
  ...permissions: Permission[]
): boolean {
  if (!user) return false;
  if (ELEVATED_ROLES.includes(user.role)) return true;
  const granted = user.permissionsByProject[projectId] ?? [];
  return permissions.every((p) => granted.includes(p));
}

// DOMAINS_* и сайдбар-гейтинг — единственные случаи без конкретного projectId (решение
// пользователя: домены не привязаны к одному проекту, остаются общим правом роли; сайдбар —
// "есть ли доступ хотя бы на одном проекте"). Зеркалит backend
// PermissionsService.hasAnyProjectPermission.
export function hasAnyPermission(
  user: Pick<User, 'role' | 'permissionsByProject'> | null | undefined,
  ...permissions: Permission[]
): boolean {
  if (!user) return false;
  if (ELEVATED_ROLES.includes(user.role)) return true;
  const granted = new Set(Object.values(user.permissionsByProject).flat());
  return permissions.every((p) => granted.has(p));
}

// Единственная группа НЕ per-project (решение пользователя 2026-07-28: домены технически не
// привязаны к одному проекту) — рендерится отдельно от остальных, одним блоком на участника
// целиком, см. DomainsPermissionsSection в team/page.tsx. Зеркалит backend
// permission.constants.ts DOMAIN_PERMISSIONS.
export const DOMAIN_PERMISSIONS: Permission[] = ['DOMAINS_VIEW', 'DOMAINS_CREATE', 'DOMAINS_EDIT', 'DOMAINS_DELETE'];

export const DOMAINS_PERMISSION_GROUP: { label: string; permissions: { value: Permission; label: string }[] } = {
  label: 'Домены',
  permissions: [
    { value: 'DOMAINS_VIEW', label: 'Просмотр' },
    { value: 'DOMAINS_CREATE', label: 'Создание' },
    { value: 'DOMAINS_EDIT', label: 'Изменение' },
    { value: 'DOMAINS_DELETE', label: 'Удаление' },
  ],
};

// Группировка по ресурсу — переиспользуется и в дефолтных шаблонах (см. team/page.tsx), и
// в матрице чекбоксов "Разрешения" в диалогах создания/редактирования участника. Домены сюда
// НЕ входят (см. DOMAINS_PERMISSION_GROUP выше) — это per-project часть.
export const PERMISSION_GROUPS: { label: string; permissions: { value: Permission; label: string }[] }[] = [
  {
    label: 'Лендинги',
    permissions: [
      { value: 'LANDINGS_VIEW', label: 'Просмотр' },
      { value: 'LANDINGS_CREATE', label: 'Создание' },
      { value: 'LANDINGS_EDIT', label: 'Изменение' },
      { value: 'LANDINGS_DELETE', label: 'Удаление' },
    ],
  },
  {
    label: 'Пиксели',
    permissions: [
      { value: 'PIXELS_VIEW', label: 'Просмотр' },
      { value: 'PIXELS_CREATE', label: 'Создание' },
      { value: 'PIXELS_EDIT', label: 'Изменение' },
      { value: 'PIXELS_DELETE', label: 'Удаление' },
    ],
  },
  {
    label: 'Пуши',
    permissions: [
      { value: 'PUSHES_VIEW', label: 'Просмотр' },
      { value: 'PUSHES_CREATE', label: 'Создание' },
      { value: 'PUSHES_SEND', label: 'Отправка' },
      { value: 'PUSHES_DELETE', label: 'Удаление' },
    ],
  },
  // Группа "Автоворонки" скрыта из редактора ролей команды (запрос пользователя 2026-07-22:
  // автоворонки временно отключены "даже из ui") — сами права AUTOMATIONS_* остаются в
  // PERMISSIONS/DEFAULT_ROLE_PERMISSIONS (бэкенд не трогаем), просто нечего включать в UI, раз
  // страницы недоступны.
  {
    label: 'A/B-тесты',
    permissions: [
      { value: 'AB_TESTS_VIEW', label: 'Просмотр' },
      { value: 'AB_TESTS_CREATE', label: 'Создание' },
      { value: 'AB_TESTS_EDIT', label: 'Изменение' },
      { value: 'AB_TESTS_DELETE', label: 'Удаление' },
    ],
  },
  {
    label: 'Канал/бот',
    permissions: [
      { value: 'CHANNEL_VIEW', label: 'Просмотр' },
      { value: 'CHANNEL_MANAGE', label: 'Управление' },
    ],
  },
  {
    label: 'Клиенты',
    permissions: [
      { value: 'CLIENTS_VIEW', label: 'Просмотр' },
      { value: 'CLIENTS_EDIT', label: 'Изменение' },
      { value: 'CLIENTS_DELETE', label: 'Удаление' },
      { value: 'CLIENTS_EXPORT', label: 'Экспорт' },
      // Запрос пользователя 2026-07-30 — видеть точно в каких ЕЩЁ проектах компании
      // встречается этот клиент (какой канал, дата вступления, диалог), не только сам факт
      // пересечения. Выдаётся на ЭТОМ проекте, не на "том другом".
      { value: 'CLIENTS_VIEW_CROSS_PROJECT', label: 'Детали пересечения с другими проектами' },
    ],
  },
  {
    label: 'Статистика',
    permissions: [
      { value: 'STATS_VIEW', label: 'Просмотр' },
      { value: 'STATS_VIEW_REVENUE', label: 'Выручка' },
      { value: 'STATS_VIEW_TEAM_LEADERBOARDS', label: 'Топ команды' },
    ],
  },
  {
    // Архивация/перегенерация токенов проекта — только Owner/Admin (решение пользователя
    // 2026-07-28, security-critical), сюда не входят.
    label: 'Настройки проекта',
    permissions: [{ value: 'PROJECTS_EDIT', label: 'Редактирование настроек' }],
  },
  {
    // Отдельная от "Пуши" группа (запрос пользователя 2026-08-06) — компания может разрешить
    // обычные рассылки через бота, но не давать доступ к рассылке с личного аккаунта живого
    // человека (репутационный/аккаунт-банный риск на реальный номер).
    label: 'Рассылка с личного аккаунта',
    permissions: [
      { value: 'PERSONAL_BROADCASTS_VIEW', label: 'Просмотр' },
      { value: 'PERSONAL_BROADCASTS_CREATE', label: 'Создание' },
      { value: 'PERSONAL_BROADCASTS_SEND', label: 'Отправка' },
      { value: 'PERSONAL_BROADCASTS_DELETE', label: 'Удаление/отмена' },
    ],
  },
];

// Дефолтные шаблоны — зеркалит apps/api/src/common/permissions/permission.constants.ts.
// Стартовая точка для формы создания, не жёсткая привязка — Owner/Admin может донастроить
// per-person до сохранения.
export const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  BUYER: [
    'LANDINGS_VIEW',
    'LANDINGS_CREATE',
    'LANDINGS_EDIT',
    'PIXELS_VIEW',
    'PIXELS_CREATE',
    'PIXELS_EDIT',
    'DOMAINS_VIEW',
    'PUSHES_VIEW',
    'PUSHES_CREATE',
    'PUSHES_SEND',
    'AUTOMATIONS_VIEW',
    'AB_TESTS_VIEW',
    'AB_TESTS_CREATE',
    'AB_TESTS_EDIT',
    'CHANNEL_VIEW',
    'CLIENTS_VIEW',
    'STATS_VIEW',
    'STATS_VIEW_REVENUE',
  ],
  OPERATOR: [
    'LANDINGS_VIEW',
    'PIXELS_VIEW',
    'PUSHES_VIEW',
    'AUTOMATIONS_VIEW',
    'AB_TESTS_VIEW',
    'CHANNEL_VIEW',
    'CLIENTS_VIEW',
    'CLIENTS_EDIT',
    'STATS_VIEW',
  ],
  // Оператор-админ (запрос пользователя 2026-07-30) — намеренно пустой, зеркалит backend
  // permission.constants.ts: единственная задача роли — управление Operator-участниками, не
  // потребление ресурсов проекта.
  OPERATOR_ADMIN: [],
};

// DEFAULT_ROLE_PERMISSIONS смешивает project-scoped и DOMAINS_* права в одном списке (как и
// backend permission.constants.ts) — при инициализации формы их нужно развести по двум
// отдельным кускам состояния (per-project матрица vs. общий блок доменов).
export function splitPermissionsByScope(permissions: Permission[]): { projectPermissions: Permission[]; domainsPermissions: Permission[] } {
  const domainSet = new Set(DOMAIN_PERMISSIONS);
  return {
    projectPermissions: permissions.filter((p) => !domainSet.has(p)),
    domainsPermissions: permissions.filter((p) => domainSet.has(p)),
  };
}
