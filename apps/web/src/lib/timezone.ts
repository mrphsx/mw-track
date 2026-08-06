// Конвертация "стенных" даты+времени в выбранной IANA-зоне в реальный UTC-момент — нужно для
// таймзоны отправки рассылки (запрос пользователя 2026-08-05: "выбор часового пояса когда
// выбираем время для рассылки"). Без внешней библиотеки (date-fns-tz/luxon не установлены) —
// стандартный приём через Intl.DateTimeFormat: берём дату как если бы она уже была в UTC (просто
// якорь-инстант), смотрим, как этот инстант выглядит в целевой зоне, разницу вычитаем обратно.
// Погрешность возможна только у экзотических зон (UTC+13 и т.п.) ровно в момент перехода на
// летнее/зимнее время — не критично для формы планирования рассылки.
function getTimezoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') parts[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - date.getTime();
}

export function zonedTimeToUtcIso(dateStr: string, timeStr: string, timeZone: string): string {
  const anchor = new Date(`${dateStr}T${timeStr}:00Z`);
  const offsetMs = getTimezoneOffsetMs(anchor, timeZone);
  return new Date(anchor.getTime() - offsetMs).toISOString();
}

// Часовой пояс "того, кто сидит в CRM прямо сейчас" (запрос пользователя 2026-08-05) — берётся
// из браузера, не хранится в профиле: это именно текущий физический пояс сотрудника в моменте, а
// не настройка проекта (Project.timezone — другое, про группировку графиков по дням).
export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

// Обратная операция для формы редактирования рассылки (запрос пользователя 2026-08-05: "добавь
// возможность редактирования запланированных") — Push.scheduledAt хранит только UTC-момент, сам
// часовой пояс, в котором его выбирали при создании, нигде не сохраняется, поэтому при открытии
// формы редактирования дата/время просто показываются в ТЕКУЩЕМ часовом поясе браузера (тот же
// дефолт, что и у getBrowserTimezone выше) — пользователь может тут же сверить/поменять зону.
export function utcIsoToZonedParts(isoString: string, timeZone: string): { dateStr: string; timeStr: string } {
  const date = new Date(isoString);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') parts[p.type] = p.value;
  return { dateStr: `${parts.year}-${parts.month}-${parts.day}`, timeStr: `${parts.hour}:${parts.minute}` };
}
