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
  'STATS_VIEW',
  'STATS_VIEW_REVENUE',
  'STATS_VIEW_TEAM_LEADERBOARDS',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ELEVATED_ROLES = ['OWNER', 'ADMIN', 'SUPER_ADMIN'];

// Elevated роли (OWNER/ADMIN/SUPER_ADMIN) всегда полный доступ, не проверяются по списку —
// зеркалит backend isElevatedRole/PermissionsGuard.
export function hasPermission(user: Pick<User, 'role' | 'permissions'> | null | undefined, ...permissions: Permission[]): boolean {
  if (!user) return false;
  if (ELEVATED_ROLES.includes(user.role)) return true;
  return permissions.every((p) => user.permissions.includes(p));
}

// Группировка по ресурсу — переиспользуется и в дефолтных шаблонах (см. team/page.tsx), и
// в матрице чекбоксов "Разрешения" в диалогах создания/редактирования участника.
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
    label: 'Домены',
    permissions: [
      { value: 'DOMAINS_VIEW', label: 'Просмотр' },
      { value: 'DOMAINS_CREATE', label: 'Создание' },
      { value: 'DOMAINS_EDIT', label: 'Изменение' },
      { value: 'DOMAINS_DELETE', label: 'Удаление' },
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
  {
    label: 'Автоворонки',
    permissions: [
      { value: 'AUTOMATIONS_VIEW', label: 'Просмотр' },
      { value: 'AUTOMATIONS_CREATE', label: 'Создание' },
      { value: 'AUTOMATIONS_EDIT', label: 'Изменение' },
      { value: 'AUTOMATIONS_DELETE', label: 'Удаление' },
    ],
  },
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
};
