const STUDIO_PREFIX = '/dashboard/studio';

// Страницы без пары в дизайне Studio — переключение отсюда уводит на "Обзор" Studio, а не на
// 404. /projects/:id/automations* — Drip Campaigns, скрыты из интерфейса целиком (см. CLAUDE.md,
// "automation flows (3.1) were temporarily hidden from the UI"), поэтому и Studio-пары нет.
// (/projects сам по себе получил Studio-пару 2026-07-30 — см. dashboard/studio/projects/page.tsx.)
function hasNoStudioEquivalent(pathname: string): boolean {
  return pathname.includes('/automations');
}

export function toStudioPath(pathname: string, search: string): string {
  const target = hasNoStudioEquivalent(pathname) ? STUDIO_PREFIX : pathname === '/' ? STUDIO_PREFIX : `${STUDIO_PREFIX}${pathname}`;
  return search ? `${target}${search}` : target;
}

export function toClassicPath(pathname: string, search: string): string {
  const stripped = pathname.startsWith(STUDIO_PREFIX) ? pathname.slice(STUDIO_PREFIX.length) : pathname;
  const target = stripped === '' ? '/' : stripped;
  return search ? `${target}${search}` : target;
}
