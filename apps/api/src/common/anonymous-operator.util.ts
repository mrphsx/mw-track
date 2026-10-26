import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './decorators/current-user.decorator';

// «Скрытый оператор» (запрос пользователя 2026-10-25, как Hide Operator в Chatterfy): работает с
// чатами и своими клиентами, но не видит личных данных лида — имя, @username, Telegram ID,
// телефон, email, фото. Вместо имени — «Лид #XXXXX» (хвост id записи, чтобы лидов можно было
// различать и называть коллегам). Флаг читается из базы, а не из токена — снятие действует сразу.
export async function isAnonymousOperator(prisma: PrismaService, user: AuthUser): Promise<boolean> {
  if (user.role !== UserRole.OPERATOR) return false;
  const row = await prisma.user.findUnique({ where: { id: user.userId }, select: { chatAnonymous: true } });
  return !!row?.chatAnonymous;
}

export function anonymousLeadName(id: string): string {
  return `Лид #${id.slice(-5).toUpperCase()}`;
}

// Карточка/строка клиента без личных данных — поля верхнего уровня, если они есть в объекте.
export function maskClientPersonal<T extends { id: string }>(client: T): T {
  const masked: Record<string, unknown> = { ...client };
  if ('tgFirstName' in masked) masked.tgFirstName = anonymousLeadName(client.id);
  for (const key of ['tgLastName', 'tgUsername', 'tgUserId', 'phone', 'email', 'tgPhotoUrl', 'tgInviteLink']) {
    if (key in masked) masked[key] = null;
  }
  return masked as T;
}
