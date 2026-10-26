import { PrismaService } from '../../../prisma/prisma.service';

// Привязка Telegram-аккаунтов сотрудников к профилю CRM (2026-10-26, вход из мини-аппа бота
// оповещений). Чистые функции на Prisma — их зовут и бот оповещений (/start), и вход мини-аппа,
// без зависимости модулей друг от друга.

export interface TelegramIdentity {
  tgUserId: string;
  username: string | null; // без @, в нижнем регистре
  firstName: string | null;
}

export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,40}$/;

// Одноразовая ссылка: человек сам открыл бота по ссылке из своего профиля — аккаунт его.
export async function bindByLinkToken(prisma: PrismaService, companyId: string, token: string, who: TelegramIdentity) {
  if (!LINK_TOKEN_PATTERN.test(token)) return { ok: false as const, reason: 'Ссылка недействительна' };
  const row = await prisma.userTelegramAccount.findUnique({ where: { linkToken: token } });
  if (!row || row.companyId !== companyId) return { ok: false as const, reason: 'Ссылка недействительна' };
  if (!row.linkTokenExpiresAt || row.linkTokenExpiresAt < new Date()) {
    await prisma.userTelegramAccount.delete({ where: { id: row.id } });
    return { ok: false as const, reason: 'Ссылка устарела — создайте новую в профиле CRM' };
  }
  const taken = await prisma.userTelegramAccount.findUnique({ where: { companyId_tgUserId: { companyId, tgUserId: who.tgUserId } } });
  if (taken && taken.userId !== row.userId) {
    return { ok: false as const, reason: 'Этот Telegram уже привязан к другому сотруднику компании — сначала отвяжите его там' };
  }
  if (taken) {
    // Уже привязан к этому же профилю — одноразовая строка больше не нужна.
    await prisma.userTelegramAccount.delete({ where: { id: row.id } });
    return { ok: true as const, userId: row.userId };
  }
  await prisma.userTelegramAccount.update({
    where: { id: row.id },
    data: { tgUserId: who.tgUserId, username: who.username, tgFirstName: who.firstName, linkToken: null, linkTokenExpiresAt: null, linkedAt: new Date() },
  });
  return { ok: true as const, userId: row.userId };
}

// Аккаунт сотрудника по Telegram: сначала по постоянному id, иначе — ещё не привязанная строка,
// добавленная по @тегу (тогда закрепляем id: дальше тег может меняться). Строку, уже закреплённую
// за другим id, по тегу не отдаём — тег мог перейти к другому человеку.
export async function findOrBindAccount(prisma: PrismaService, companyId: string, who: TelegramIdentity) {
  const byId = await prisma.userTelegramAccount.findUnique({ where: { companyId_tgUserId: { companyId, tgUserId: who.tgUserId } } });
  if (byId) {
    if (byId.username !== who.username || byId.tgFirstName !== who.firstName) {
      await prisma.userTelegramAccount.update({ where: { id: byId.id }, data: { username: who.username, tgFirstName: who.firstName } });
    }
    return byId;
  }
  if (!who.username) return null;
  const pending = await prisma.userTelegramAccount.findFirst({
    where: { companyId, username: who.username, tgUserId: null, linkToken: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!pending) return null;
  return prisma.userTelegramAccount.update({
    where: { id: pending.id },
    data: { tgUserId: who.tgUserId, tgFirstName: who.firstName, linkedAt: new Date() },
  });
}
