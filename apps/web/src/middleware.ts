import { NextRequest, NextResponse } from 'next/server';

// Разделение дизайнов по домену (запрос пользователя 2026-07-30: "старый дизайн перенеси на
// поддомен old.mw-track.com... путь / должен вести сразу на новый дизайн"). Физически файлы
// Studio остались там же, где были весь день (apps/web/src/app/dashboard/studio/**) — их
// собственные внутренние ссылки теперь используют "голые" пути (/projects, /projects/:id и
// т.д., без префикса), а этот middleware на основном домене прозрачно (invisible для адресной
// строки браузера — NextResponse.rewrite меняет только то, какой файл резолвит Next.js, URL у
// пользователя остаётся чистым) подставляет префикс /dashboard/studio обратно перед тем, как
// Next.js станет резолвить страницу. На old.mw-track.com рерайта нет вообще — классические
// страницы из (dashboard)/* и так уже физически лежат на "голых" путях, ничего переписывать
// не нужно.
const STUDIO_PREFIX = '/dashboard/studio';

// Общие для обоих дизайнов страницы — один и тот же файл на обоих доменах, у Studio нет
// собственных /login и т.п., рерайтить их нельзя.
const SHARED_PATHS = ['/login', '/register', '/invite'];

function isSharedPath(pathname: string): boolean {
  return SHARED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Специальные файлы метаданных App Router (favicon-иконка, добавлена 2026-08-18) — генерируются
// Next.js по пути БЕЗ расширения (/icon, не /icon.png), поэтому регэксп на расширение файла ниже
// их не ловит — тот же класс бага, что и со статикой из public/ выше, просто без точки в пути.
const METADATA_PATHS = ['/icon', '/apple-icon', '/opengraph-image', '/twitter-image'];

function isMetadataPath(pathname: string): boolean {
  return METADATA_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';

  // old.mw-track.com — классика без изменений.
  if (host.startsWith('old.')) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Уже префиксовано (прямой переход по /dashboard/studio/...) или общая страница — не трогаем,
  // иначе задвоили бы префикс (/dashboard/studio/dashboard/studio/...).
  // Статика из public/ (например /docs/overview.png, добавлено 2026-07-31 для страницы
  // документации) — тоже не трогаем: файловые пути с расширением никогда не являются
  // страницами App Router, а рерайт под STUDIO_PREFIX резолвил бы их в несуществующий путь
  // /dashboard/studio/docs/overview.png → 404 (реальный баг, найденный при первом использовании
  // public/ в этом приложении — раньше здесь просто не было статических файлов, которые могли
  // бы столкнуться с этим рерайтом).
  if (pathname.startsWith(STUDIO_PREFIX) || isSharedPath(pathname) || isMetadataPath(pathname) || /\.[a-zA-Z0-9]+$/.test(pathname)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = pathname === '/' ? STUDIO_PREFIX : `${STUDIO_PREFIX}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico).*)'],
};
