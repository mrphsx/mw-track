import { nanoid } from 'nanoid';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Короткие коды баера/пикселя в трекинг-ссылках (запрос пользователя 2026-08-20: "давай
// сократим значения только для айди пользователя z= и для пикселя pixel=... чтобы и хватило
// символов... под миллионы баеров и под сотни миллионов пикселей, но укоротим максимально") —
// заменяют полный id (@default(cuid()), всегда ровно 25 символов) в query-параметрах ссылки.
//
// Длина — единственный признак старый/новый формат при разборе входящей ссылки (см.
// resolveBuyerShortCode/resolvePixelShortCode ниже): у cuid() всегда ровно CUID_LENGTH символов,
// у короткого кода — всегда ровно SHORT_CODE_LENGTH, эти длины никогда не совпадают, поэтому
// разбор однозначен без явного маркера формата и БЕЗ миграции уже существующих (в т.ч. уже
// вставленных в реальные объявления Facebook/TikTok) ссылок — старые продолжают резолвиться
// напрямую как id, ничего не меняя в их поведении.
//
// 6 символов default-алфавита nanoid (64 символа, тот же алфавит, что уже используется в этом
// проекте для start-кодов/event-id) — 64^6 ≈ 68.7 млрд комбинаций, с большим запасом на порядки
// вперёд сверх "миллионов баеров"/"сотен миллионов пикселей" из запроса.
export const SHORT_CODE_LENGTH = 6;
export const CUID_LENGTH = 25;

// Генерирует короткий код и создаёт строку через переданный колбэк, повторяя попытку при
// коллизии уникального индекса (P2002) — при таком объёме комбинаций коллизия практически
// невозможна, но защита от неё дешева и не полагается на удачу. НЕ использовать внутри уже
// открытой интерактивной $transaction — Postgres абортит всю транзакцию при первой же ошибке
// (в т.ч. P2002), повторный запрос на том же tx после этого сам упадёт с "current transaction is
// aborted" вместо честной повторной попытки — для этого случая см. generateUniqueBuyerShortCode/
// generateUniquePixelShortCode ниже (пречек ДО входа в транзакцию, без catch-и-повтори).
export async function withUniqueShortCode<T>(create: (code: string) => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await create(nanoid(SHORT_CODE_LENGTH));
    } catch (error) {
      const isUniqueViolation = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!isUniqueViolation || attempt === MAX_ATTEMPTS) throw error;
    }
  }
  throw new Error('withUniqueShortCode: недостижимо');
}

// Пречек-версия для вызова ДО входа в транзакцию (TeamInvitesService.accept — user.create там
// внутри $transaction, где catch-и-повтори небезопасен, см. комментарий выше). Микроскопическая
// гонка (два одновременных accept успели проверить один и тот же код до того, как оба его
// записали) в теории возможна, но перекрывается тем же @unique на колонке — в этом случае
// собственно create внутри транзакции провалится, и accept целиком корректно отобьётся ошибкой
// для повторной попытки пользователем, как и любая другая гонка "email уже занят" рядом.
export async function generateUniqueBuyerShortCode(prisma: PrismaService): Promise<string> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const code = nanoid(SHORT_CODE_LENGTH);
    const existing = await prisma.user.findUnique({ where: { buyerShortCode: code }, select: { id: true } });
    if (!existing) return code;
  }
  throw new Error('generateUniqueBuyerShortCode: не удалось подобрать свободный код');
}

// raw.length === CUID_LENGTH — это уже настоящий User.id (старая ссылка, сгенерированная до
// внедрения коротких кодов, либо код всё ещё не был создан для этого баера) — возвращаем как
// есть, без похода в базу. Короче — ищем по короткому коду; не найден (устаревший/битый код) —
// undefined, тот же результат, что и при отсутствии баера вообще ("БЕЗ БАЕРА"), не ошибка.
export async function resolveBuyerShortCode(prisma: PrismaService, raw: string | null | undefined): Promise<string | undefined> {
  if (!raw) return undefined;
  if (raw.length === CUID_LENGTH) return raw;
  const user = await prisma.user.findUnique({ where: { buyerShortCode: raw }, select: { id: true } });
  return user?.id;
}

export async function resolvePixelShortCode(prisma: PrismaService, raw: string | null | undefined): Promise<string | undefined> {
  if (!raw) return undefined;
  if (raw.length === CUID_LENGTH) return raw;
  const pixel = await prisma.trackingPixel.findUnique({ where: { shortCode: raw }, select: { id: true } });
  return pixel?.id;
}
