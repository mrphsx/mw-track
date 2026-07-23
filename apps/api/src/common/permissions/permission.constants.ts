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
};

// Роли, которые физически проверяются по UserPermission — остальные (SUPER_ADMIN/OWNER/
// ADMIN) elevated, безусловный полный доступ.
export const RESTRICTED_ROLES: UserRole[] = [UserRole.BUYER, UserRole.OPERATOR];

export function isElevatedRole(role: UserRole): boolean {
  return !RESTRICTED_ROLES.includes(role);
}
