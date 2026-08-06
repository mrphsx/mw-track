import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// Общая проверка для TeamService.create/update и TeamInvitesService.create — только настоящий
// Owner назначает роль ADMIN (RolesGuard рангом этого не выражает, см. roles.guard.ts).
export function assertCanAssignRole(requesterRole: UserRole, targetRole: string): void {
  if (targetRole === 'ADMIN' && requesterRole !== 'OWNER' && requesterRole !== 'SUPER_ADMIN') {
    throw new ForbiddenException('Только владелец может назначать роль Admin');
  }
  // Оператор-админ (запрос пользователя 2026-07-30) может назначать только роль Operator —
  // не Admin, не Buyer, не другого оператор-админа.
  if (requesterRole === UserRole.OPERATOR_ADMIN && targetRole !== 'OPERATOR') {
    throw new ForbiddenException('Оператор-админ может назначать только роль Operator');
  }
}

export async function assertProjectsBelongToCompany(prisma: PrismaService, companyId: string, projectIds: string[]): Promise<void> {
  const count = await prisma.project.count({ where: { id: { in: projectIds }, companyId, deletedAt: null } });
  if (count !== projectIds.length) throw new BadRequestException('Один или несколько проектов не найдены');
}

// Кто вообще может дотрагиваться до /team и /team-invites — RolesGuard's @Roles(OWNER) снят с
// этих контроллеров намеренно (его ранговая модель — Math.min(...requiredRoles) — тихо впустила
// бы BUYER/OPERATOR, если бы OPERATOR_ADMIN (ранг 1, тот же уровень) попал в общий список ролей
// декоратора). Проверяем явной ролью здесь, в начале каждого сервисного метода.
// SUPER_ADMIN — баг найден 2026-07-30 ("в админке не показывает команду компании"):
// AdminCompanyService.getTeam зовёт TeamService.findAll(companyId, '', UserRole.SUPER_ADMIN)
// для дрилл-дауна платформенного админа, а этот список изначально не включал SUPER_ADMIN — со
// старым @Roles(OWNER) (ранговый порог) это работало само собой (SUPER_ADMIN ранга 5 >= 4),
// но явная проверка ролью так не умеет, нужно перечислить явно.
const TEAM_MANAGER_ROLES: UserRole[] = [UserRole.OWNER, UserRole.ADMIN, UserRole.OPERATOR_ADMIN, UserRole.SUPER_ADMIN];

export function assertCanAccessTeamManagement(requesterRole: UserRole): void {
  if (!TEAM_MANAGER_ROLES.includes(requesterRole)) {
    throw new ForbiddenException('Недостаточно прав для управления командой');
  }
}

// Оператор-админ project-scoped (запрос пользователя 2026-07-30, подтверждено явно: "только свои
// проекты") — может управлять только участниками с ролью Operator, и только в рамках проектов,
// к которым у него самого есть ProjectAccess. targetRole — роль цели ПОСЛЕ применения изменений
// (для update это dto.role ?? текущая роль). projectIdSets — все наборы project id, которые нужно
// проверить (для update/remove это И существующий ProjectAccess цели, И новый dto.projectIds —
// update делает полную замену набора, поэтому нельзя полагаться только на новый список: иначе
// оператор-админ мог бы частичным обновлением тихо снять доступ к проекту вне своей зоны).
export async function assertOperatorAdminScope(
  prisma: PrismaService,
  requesterId: string,
  requesterRole: UserRole,
  targetRole: UserRole,
  ...projectIdSets: (string[] | undefined)[]
): Promise<void> {
  if (requesterRole !== UserRole.OPERATOR_ADMIN) return;
  if (targetRole !== UserRole.OPERATOR) {
    throw new ForbiddenException('Оператор-админ может управлять только участниками с ролью Operator');
  }
  const own = await prisma.projectAccess.findMany({ where: { userId: requesterId }, select: { projectId: true } });
  const ownIds = new Set(own.map((a) => a.projectId));
  for (const ids of projectIdSets) {
    if (ids?.some((id) => !ownIds.has(id))) {
      throw new ForbiddenException('Нельзя управлять участником с доступом к проектам вне вашей зоны ответственности');
    }
  }
}
