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
// Границы периода как SQL-выражения от часового пояса tz. tz — либо параметр (одна зона,
// resolveStatsPeriod), либо колонка (у каждого проекта своя, projectPeriodWindowsSql) — так
// страница проекта и общая статистика считают сутки строго одной и той же формулой.
// period не задан — "всё время" (только для общей статистики; resolveStatsPeriod подставляет 30d).
function periodBoundsSql(tz: Prisma.Sql, query: StatsPeriodDto): { since: Prisma.Sql; until: Prisma.Sql } {
  const today = Prisma.sql`date_trunc('day', now() AT TIME ZONE ${tz})`;
  switch (query.period) {
    case undefined:
      return { since: Prisma.sql`'-infinity'::timestamptz`, until: Prisma.sql`'infinity'::timestamptz` };
    // 7d/30d — было чистое скользящее окно от new Date() (168ч/720ч), без привязки к суткам и
    // без зоны проекта; с 2026-08-18 это N календарных суток в зоне, включая весь сегодняшний день.
    case '7d':
    case '30d': {
      const days = query.period === '7d' ? 7 : 30;
      return {
        since: Prisma.sql`(${today} - make_interval(days => ${days - 1}::int)) AT TIME ZONE ${tz}`,
        until: Prisma.sql`(${today} + make_interval(days => 1)) AT TIME ZONE ${tz}`,
      };
    }
    case 'today':
    case 'yesterday': {
      const offset = query.period === 'yesterday' ? -1 : 0;
      return {
        since: Prisma.sql`(${today} + make_interval(days => ${offset}::int)) AT TIME ZONE ${tz}`,
        until: Prisma.sql`(${today} + make_interval(days => ${offset + 1}::int)) AT TIME ZONE ${tz}`,
      };
    }
    case 'custom': {
      if (!query.from || !query.to) {
        throw new BadRequestException('Для кастомного периода нужны from и to');
      }
      // ::timestamp обязателен: `date AT TIME ZONE tz` в PostgreSQL сначала трактует дату как
      // полночь по UTC и переводит её В локальное время — обратное направление. Начало периода
      // уезжало на удвоенный часовой пояс (Колумбия −10 ч, Коста-Рика −12 ч), и «14.10» считало
      // 34 часа вместо 24 (2026-10-20).
      return {
        since: Prisma.sql`(${query.from}::date::timestamp) AT TIME ZONE ${tz}`,
        until: Prisma.sql`(${query.to}::date::timestamp + interval '1 day') AT TIME ZONE ${tz}`,
      };
    }
  }
}

export async function resolveStatsPeriod(
  prisma: PrismaService,
  timezone: string,
  query: StatsPeriodDto,
): Promise<{ since: Date; until: Date }> {
  const { since, until } = periodBoundsSql(Prisma.sql`${timezone}`, { ...query, period: query.period ?? '30d' });
  const [row] = await prisma.$queryRaw<{ since: Date; until: Date }[]>`SELECT ${since} as since, ${until} as until`;
  return row;
}

// Окно периода для каждого проекта в его собственном часовом поясе: подзапрос со строками
// (pid, since, until). Общая статистика компании (запрос пользователя 2026-10-20: «каждый проект
// в своём поясе») джойнит его по projectId, поэтому карточка проекта на главной совпадает со
// страницей проекта, а итог — сумма проектов. Раньше всё считалось одними сутками по UTC.
export function projectPeriodWindowsSql(projectIds: string[], query: StatsPeriodDto): Prisma.Sql {
  const { since, until } = periodBoundsSql(Prisma.sql`p."timezone"`, query);
  return Prisma.sql`SELECT p.id AS pid, ${since} AS since, ${until} AS until FROM "Project" p WHERE p.id IN (${Prisma.join(projectIds)})`;
}
