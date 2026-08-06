import { Permission, UserRole } from '@prisma/client';

// Дефолтные шаблоны прав (запрос пользователя 2026-07-17) — стартовая точка для формы
// создания/редактирования участника команды, не жёсткая привязка: Owner/Admin может
// добавить/убрать любую галочку до сохранения. OWNER/ADMIN/SUPER_ADMIN намеренно
// отсутствуют как ключи — они elevated-роли, всегда полный доступ без единой строки
// UserPermission (см. PermissionsGuard/assertPermission).
export const DEFAULT_ROLE_PERMISSIONS: Partial<Record<UserRole, Permission[]>> = {
  // Медиабайер — работает с трафиком/оптимизацией: создаёт/правит лендинги и пиксели,
  // шлёт пуши, крутит A/B-тесты, видит свою статистику и выручку. Без *_DELETE нигде (не
  // теряем данные по ошибке), без DOMAINS_CREATE/EDIT (домены — инфраструктура, зона
  // Owner/Admin), без STATS_VIEW_TEAM_LEADERBOARDS (не видит рейтинг других баеров по
  // умолчанию — конкурентно-чувствительно).
  BUYER: [
    Permission.LANDINGS_VIEW,
    Permission.LANDINGS_CREATE,
    Permission.LANDINGS_EDIT,
    Permission.PIXELS_VIEW,
    Permission.PIXELS_CREATE,
    Permission.PIXELS_EDIT,
    Permission.DOMAINS_VIEW,
    Permission.PUSHES_VIEW,
    Permission.PUSHES_CREATE,
    Permission.PUSHES_SEND,
    Permission.AUTOMATIONS_VIEW,
    Permission.AB_TESTS_VIEW,
    Permission.AB_TESTS_CREATE,
    Permission.AB_TESTS_EDIT,
    Permission.CHANNEL_VIEW,
    Permission.CLIENTS_VIEW,
    Permission.STATS_VIEW,
    Permission.STATS_VIEW_REVENUE,
  ],
  // Саппорт/работа с клиентами — видит меньше, чем баер (не создаёт лендинги/пуши/тесты),
  // зато может редактировать клиентов (регистрация депозитов, заметки), без выручки/
  // лидербордов.
  OPERATOR: [
    Permission.LANDINGS_VIEW,
    Permission.PIXELS_VIEW,
    Permission.PUSHES_VIEW,
    Permission.AUTOMATIONS_VIEW,
    Permission.AB_TESTS_VIEW,
    Permission.CHANNEL_VIEW,
    Permission.CLIENTS_VIEW,
    Permission.CLIENTS_EDIT,
    Permission.STATS_VIEW,
  ],
  // Оператор-админ (запрос пользователя 2026-07-30) — намеренно пустой массив, а не
  // отсутствие ключа: роль не потребляет ресурсы проекта сама (не открывает лендинги/
  // пиксели/клиентов и т.д.), её единственная задача — управление участниками с ролью
  // Operator в пределах своих же проектов (см. team-role.util.ts assertOperatorAdminScope).
  OPERATOR_ADMIN: [],
};

// DOMAINS_* — единственная группа прав, которая НЕ per-project (решение пользователя
// 2026-07-28: домены технически не привязаны к одному проекту). Хранится в UserPermission с
// обычным projectId (см. schema.prisma), но применяется/читается по-другому — см.
// PermissionsService.applyProjectPermissions (полная замена на КАЖДОМ проекте разом, не
// add-only) и hasAnyProjectPermission (грант хотя бы на одном проекте = грант везде).
export const DOMAIN_PERMISSIONS: Permission[] = [
  Permission.DOMAINS_VIEW,
  Permission.DOMAINS_CREATE,
  Permission.DOMAINS_EDIT,
  Permission.DOMAINS_DELETE,
];

// Роли, которые физически проверяются по UserPermission — остальные (SUPER_ADMIN/OWNER/
// ADMIN) elevated, безусловный полный доступ.
export const RESTRICTED_ROLES: UserRole[] = [UserRole.BUYER, UserRole.OPERATOR, UserRole.OPERATOR_ADMIN];

export function isElevatedRole(role: UserRole): boolean {
  return !RESTRICTED_ROLES.includes(role);
}
