// Расписание регулярной рассылки (2026-11-05): дни недели и время в часовом поясе рассылки →
// ближайший момент отправки в UTC. Без сторонних библиотек: смещение пояса берём из Intl.

export interface RecurrenceDay {
  day: number; // 1 — понедельник … 7 — воскресенье
  time: string; // "HH:mm"
}

export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Части даты/времени момента `at` в поясе tz.
function zonedParts(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute'), s: get('second') };
}

// Местное время в поясе tz → момент UTC (с учётом перехода на летнее время: уточняем смещение
// дважды).
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const wanted = Date.UTC(y, m - 1, d, h, min);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    guess += wanted - asUtc;
  }
  return new Date(guess);
}

// Ближайшее срабатывание строго после `after`.
export function nextRunAfter(days: RecurrenceDay[], tz: string, after: Date): Date | null {
  if (!days.length) return null;
  const local = zonedParts(after, tz);
  for (let i = 0; i <= 8; i++) {
    const cal = new Date(Date.UTC(local.y, local.m - 1, local.d + i));
    const weekday = cal.getUTCDay() === 0 ? 7 : cal.getUTCDay();
    const times = days
      .filter((x) => x.day === weekday)
      .map((x) => x.time)
      .sort();
    for (const t of times) {
      const [hh, mm] = t.split(':').map(Number);
      const at = zonedToUtc(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), hh, mm, tz);
      if (at.getTime() > after.getTime()) return at;
    }
  }
  return null;
}
