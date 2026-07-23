import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// Общая проверка для TeamService.create/update и TeamInvitesService.create — только настоящий
// Owner назначает роль ADMIN (RolesGuard рангом этого не выражает, см. roles.guard.ts).
export function assertCanAssignRole(requesterRole: UserRole, targetRole: string): void {
  if (targetRole === 'ADMIN' && requesterRole !== 'OWNER' && requesterRole !== 'SUPER_ADMIN') {
    throw new ForbiddenException('Только владелец может назначать роль Admin');
  }
}

export async function assertProjectsBelongToCompany(prisma: PrismaService, companyId: string, projectIds: string[]): Promise<void> {
  const count = await prisma.project.count({ where: { id: { in: projectIds }, companyId, deletedAt: null } });
  if (count !== projectIds.length) throw new BadRequestException('Один или несколько проектов не найдены');
}
