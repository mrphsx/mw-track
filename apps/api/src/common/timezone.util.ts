import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StatsPeriodDto } from './dto/stats-period.dto';

// Часовой пояс проекта (запрос пользователя 2026-07-04, диалоги с клиентами) — проект может
// целиться в аудиторию на другом конце света, "сутки" во всех дневных графиках должны
// считаться по зоне проекта, а не по UTC. Postgres-идиома: колонка хранится как UTC wall-clock
// (Prisma DateTime -> timestamp(3) без явной зоны, но пишется всегда как UTC-момент) —
// "AT TIME ZONE 'UTC'" сначала трактует её как настоящий момент времени (timestamptz), затем
// "AT TIME ZONE <tz>" переводит этот момент в локальное время нужной зоны, ::date берёт
// календарную дату уже в этой локали. columnName подставляется как raw-идентификатор (вызывающий
// код сам контролирует его, не пользовательский ввод) — только timezone идёт параметризованным
// значением через Prisma.sql. tableAlias — опционально, для запросов с JOIN, где колонка с
// таким именем есть в обеих таблицах (иначе Postgres бросает "column reference is ambiguous",
// найдено 2026-07-19 живым 500 на getBestTimeStats: JOIN "PushLog"+"Push", у обеих sentAt).
export function dailyBucketSql(columnName: string, timezone: string, tableAlias?: string): Prisma.Sql {
  const column = tableAlias ? `${tableAlias}."${columnName}"` : `"${columnName}"`;
  return Prisma.sql`(${Prisma.raw(column)} AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::date`;
}

// Час суток (0-23) в зоне проекта — та же идиома, что и dailyBucketSql, просто EXTRACT(HOUR ...)
// вместо ::date (Фаза 3.4, Smart Push Timing — "в какой час пуши дают лучший CTR").
export function hourBucketSql(columnName: string, timezone: string, tableAlias?: string): Prisma.Sql {
  const column = tableAlias ? `${tableAlias}."${columnName}"` : `"${columnName}"`;
  return Prisma.sql`EXTRACT(HOUR FROM (${Prisma.raw(column)} AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}))::int`;
}

// Период статистики страницы проекта (запрос пользователя 2026-07-17) — "сегодня"/"вчера"/
// "7 дней"/"30 дней" все считаются по суткам в зоне проекта, не по UTC (тот же принцип, что и
// dailyBucketSql выше), границы для них считаются одним запросом в Postgres, а не в JS: `now()
// AT TIME ZONE tz` даёт naive wall-clock время в зоне, `date_trunc('day', ...)` берёт полночь
// этих суток, `make_interval(days => N)` сдвигает на N суток, финальный `AT TIME ZONE tz`
// (уже без 'UTC' слева) трактует naive-значение как локальное время зоны и переводит обратно
// в timestamptz (абсолютный момент) — тот же трюк, что dailyBucketSql делает в обратную
// сторону. "7d"/"30d" были чистым скользящим окном 168ч/720ч от текущего момента без выравнивания
// по суткам — переведены на календарное выравнивание 2026-08-18 (см. комментарий у самого
// вызова ниже), чтобы не расходиться с today/yesterday/custom.
export async function resolveStatsPeriod(
  prisma: PrismaService,
  timezone: string,
  query: StatsPeriodDto,
): Promise<{ since: Date; until: Date }> {
  const period = query.period ?? '30d';

  // 7d/30d — было чистое скользящее окно от new Date() (168ч/720ч назад от текущего момента),
  // без привязки к границам суток и без учёта часового пояса проекта, в отличие от today/
  // yesterday/custom рядом (все три считают "сутки" в зоне проекта). Баг-репорт пользователя
  // 2026-08-18 ("период неправильно посчитал") — это ровно тот класс несостыковки: одно и то же
  // значение "сегодня" в today и в последнем дне окна 7d могло не совпадать (7d включало кусок
  // "позавчера" по зоне проекта, если запрос пришёл не в полночь), из-за чего сумма 7 отдельных
  // "дневных" чисел не сходилась с агрегатом "7 дней". Теперь 7d/30d — те же N календарных суток
  // в зоне проекта, что и today (N=1), выровненные по полуночи: since = начало суток N-1 дней
  // назад, until = начало ЗАВТРАШНИХ суток (т.е. включает весь сегодняшний день целиком, не
  // только часть до текущего момента) — тот же принцип, что уже применяется в dailyBucketSql.
  if (period === '7d' || period === '30d') {
    const days = period === '7d' ? 7 : 30;
    const [row] = await prisma.$queryRaw<{ since: Date; until: Date }[]>`
      SELECT
        (date_trunc('day', now() AT TIME ZONE ${timezone}) - make_interval(days => ${days - 1}::int)) AT TIME ZONE ${timezone} as since,
        (date_trunc('day', now() AT TIME ZONE ${timezone}) + make_interval(days => 1)) AT TIME ZONE ${timezone} as until
    `;
    return row;
  }

  if (period === 'today' || period === 'yesterday') {
    const dayOffset = period === 'yesterday' ? -1 : 0;
    const [row] = await prisma.$queryRaw<{ since: Date; until: Date }[]>`
      SELECT
        (date_trunc('day', now() AT TIME ZONE ${timezone}) + make_interval(days => ${dayOffset}::int)) AT TIME ZONE ${timezone} as since,
        (date_trunc('day', now() AT TIME ZONE ${timezone}) + make_interval(days => ${dayOffset + 1}::int)) AT TIME ZONE ${timezone} as until
    `;
    return row;
  }

  // custom
  if (!query.from || !query.to) {
    throw new BadRequestException('Для кастомного периода нужны from и to');
  }
  const [row] = await prisma.$queryRaw<{ since: Date; until: Date }[]>`
    SELECT
      (${query.from}::date) AT TIME ZONE ${timezone} as since,
      (${query.to}::date + interval '1 day') AT TIME ZONE ${timezone} as until
  `;
  return row;
}
