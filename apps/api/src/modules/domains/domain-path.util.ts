// Чистые функции без DI — используются и из DomainsService (CRUD путей), и из
// LandingRendererService (резолвинг входящего запроса). Вынесены в отдельный файл, а не
// метод DomainsService, чтобы LandingsModule не тянул DomainsModule (тот уже импортирует
// LandingsModule за NginxService — взаимный импорт модулей создал бы циклическую зависимость).

export interface DomainPathLike {
  path: string;
  landingId: string;
}

export interface ResolvedDomainPath {
  landingId: string;
  subPath: string; // без ведущего слеша, '' для корня — формат, который ждёт renderAndServe
}

// "/", "/promo", "/a/b" — без конечного слеша (кроме самого "/"), всегда с ведущим, без
// задвоенных слешей внутри (схлопываются ДО проверки ведущего/конечного — иначе "//promo//"
// нормализовался бы в "//promo" вместо "/promo").
export function normalizeDomainPath(raw: string): string {
  let p = raw.trim().replace(/\/{2,}/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

// Path "/" — особый случай: матчит ЛЮБОЙ путь, не закрытый более специфичным маппингом (т.е.
// ведёт себя как раньше Domain.landingId — единая привязка на весь домен), остальные пути
// матчат только себя и всё, что начинается с "<path>/". Более длинные (специфичные) пути
// проверяются первыми.
export function matchDomainPath(paths: DomainPathLike[], requestPath: string): ResolvedDomainPath | null {
  const specific = paths.filter((p) => p.path !== '/').sort((a, b) => b.path.length - a.path.length);

  for (const p of specific) {
    if (requestPath === p.path || requestPath.startsWith(`${p.path}/`)) {
      return { landingId: p.landingId, subPath: requestPath.slice(p.path.length).replace(/^\//, '') };
    }
  }

  const root = paths.find((p) => p.path === '/');
  if (root) return { landingId: root.landingId, subPath: requestPath.replace(/^\//, '') };

  return null;
}
