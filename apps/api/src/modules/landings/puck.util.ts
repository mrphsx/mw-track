// Визуальный редактор Puck (запрос пользователя 2026-10-21: «интегрируй Puck как отдельный вид
// создания лендингов»). Страницу собирает браузер: тот же набор блоков, что в редакторе, рендерится
// в статичную разметку и приходит сюда вместе с состоянием редактора (data). Сервер хранит оба в
// LandingPuckContent и при показе подставляет разметку в templates/puck/template.html.
//
// Доверие к разметке — как у CUSTOM-лендинга из ZIP: это HTML самого клиента, отдаётся на его же
// домене. Здесь проверяются только размер и форма, а не содержимое.

export const PUCK_TEMPLATE_ID = 'puck';

export const PUCK_LIMITS = {
  maxDataBytes: 400_000,
  maxHtmlBytes: 600_000,
} as const;

export function validatePuckContent(data: unknown, html: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'Нет содержимого страницы';
  const d = data as { root?: unknown; content?: unknown };
  if (!Array.isArray(d.content)) return 'Содержимое страницы повреждено';
  if (typeof html !== 'string' || !html.trim()) return 'Нет разметки страницы';
  if (Buffer.byteLength(JSON.stringify(data)) > PUCK_LIMITS.maxDataBytes) return 'Страница слишком большая — уберите часть блоков';
  if (Buffer.byteLength(html) > PUCK_LIMITS.maxHtmlBytes) return 'Страница слишком большая — уберите часть блоков';
  return null;
}

// Заголовок вкладки — поле «Заголовок страницы» в настройках страницы редактора.
export function puckPageTitle(data: unknown): string {
  const title = (data as { root?: { props?: { title?: unknown } } } | null)?.root?.props?.title;
  return typeof title === 'string' ? title.trim().slice(0, 200) : '';
}

// Несколько шагов или попап — авторедирект ждёт, пока посетитель дойдёт до конца (как у
// age-gate-invite и многошагового конструктора), иначе его уведёт раньше, чем он ответит.
export function puckNeedsDeferredRedirect(html: string): boolean {
  const steps = html.match(/data-pk-step(?=[\s>=])/g)?.length ?? 0;
  return steps > 1 || /data-pk-popup(?=[\s>=])/.test(html);
}

export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Число подписчиков хранится как есть («14200») — на странице показываем с разделителями.
export function formatSubscribersCount(raw: string | undefined): string {
  const v = (raw || '').trim();
  return /^\d+$/.test(v) ? v.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : escapeHtmlText(v);
}
