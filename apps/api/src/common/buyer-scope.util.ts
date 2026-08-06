import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// "Только свои клиенты" для Buyer (запрос пользователя 2026-08-03, переключатель по каждому
// сотруднику отдельно) — вызывается в начале каждого контроллерного метода, которому нужен
// скоуп (тот же стиль, что уже повторяющиеся assertAccess/hasPermission-вызовы в этих же
// контроллерах). Возвращает userId, если запрос нужно жёстко ограничить его собственными
// клиентами, иначе undefined (elevated-роли и не-BUYER роли никогда не скоупятся здесь —
// у Operator своя отдельная модель видимости через /my-clients, не через это поле).
export async function resolveScopedBuyerId(prisma: PrismaService, userId: string, role: UserRole): Promise<string | undefined> {
  if (role !== UserRole.BUYER) return undefined;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { clientsVisibilityScope: true } });
  return user?.clientsVisibilityScope === 'OWN_CLIENTS' ? userId : undefined;
}
