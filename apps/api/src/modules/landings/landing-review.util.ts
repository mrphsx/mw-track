import { Parser } from 'htmlparser2';

// Общий формат результата проверки — используется и для CUSTOM-лендинга (ZIP), и для EXTERNAL
// (проверка подключения чужого сервера), одним и тем же фронтенд-компонентом ReviewChecklist
// (запрос пользователя 2026-09-07).
export interface LandingReviewCheck {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}

const ASSET_ATTR_BY_TAG: Record<string, string> = {
  link: 'href',
  script: 'src',
  img: 'src',
};

// Абсолютные (http:, data:, mailto:...), протокол-относительные (//cdn...) и шаблонные ({{...}})
// ссылки не могут быть "битыми файлами архива" по определению — пропускаем их из проверки
// asset-refs, чтобы не плодить ложные срабатывания на внешних CDN-ресурсах клиента.
function isSkippableRef(value: string): boolean {
  if (!value) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return true;
  if (value.startsWith('//')) return true;
  if (value.includes('{{')) return true;
  return false;
}

// Резолвит относительный путь ссылки против корня архива (только "." и ".." сегменты —
// index.html всегда лежит в корне, поэтому базой всегда служит сам корень архива).
function normalizeRelativePath(value: string): string {
  const withoutQuery = value.split(/[?#]/)[0];
  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    // оставляем как есть — не должно ронять саму проверку
  }
  const stack: string[] = [];
  for (const part of decoded.replace(/^\.\//, '').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

// Реальная проверка кода кастомного (ZIP) лендинга перед публикацией (запрос пользователя
// 2026-09-07: "надо полностью пройтись по коду и сверить все ли правильно, есть ли все ссылки,
// валиден ли html"). htmlparser2 намеренно ТЕРПИМЫЙ парсер (тот же, на котором построен cheerio)
// — не бросает на кривом, но реальном HTML, поэтому "валидность" здесь не строгий W3C-валидатор,
// а практичная проверка: файл вообще разбирается как HTML, кнопка перехода на месте, ссылки на
// файлы архива не битые. Именно эти три вещи реально ломают лендинг клиента на практике.
export function reviewLandingHtml(
  html: string,
  entryNames: Set<string>,
  // requireRedirectPlaceholder=false — для white page клоакинга (запрос пользователя
  // 2026-09-23): это decoy-страница без кнопки перехода в Telegram, чек на {{TG_REDIRECT_URL}}
  // для неё бессмыслен. Дефолт true сохраняет поведение единственного места, где эта функция
  // уже вызывалась (LandingsService.processAndReviewZip, основной CUSTOM-лендинг).
  options: { requireRedirectPlaceholder?: boolean } = {},
): LandingReviewCheck[] {
  const requireRedirectPlaceholder = options.requireRedirectPlaceholder ?? true;
  let tagCount = 0;
  const brokenRefs: string[] = [];
  const seenRefs = new Set<string>();

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        tagCount++;
        const attrName = ASSET_ATTR_BY_TAG[name];
        if (!attrName) return;
        const raw = attribs[attrName];
        if (!raw || isSkippableRef(raw) || seenRefs.has(raw)) return;
        seenRefs.add(raw);
        const normalized = normalizeRelativePath(raw);
        if (!normalized) return;
        if (!entryNames.has(normalized) && !entryNames.has(normalized.toLowerCase())) {
          brokenRefs.push(raw);
        }
      },
    },
    { decodeEntities: true },
  );

  try {
    parser.parseComplete(html);
  } catch {
    // htmlparser2 практически никогда не бросает — страховка, чтобы одна проверка не роняла
    // всю загрузку архива.
  }

  const hasStructure = tagCount > 0;
  const hasRedirectPlaceholder = html.includes('{{TG_REDIRECT_URL}}');
  const hasBrokenRefs = brokenRefs.length > 0;

  const checks: LandingReviewCheck[] = [
    {
      id: 'html-structure',
      label: 'index.html — это разбираемый HTML',
      passed: hasStructure,
      detail: hasStructure
        ? undefined
        : 'В файле не найдено ни одного HTML-тега — убедитесь, что это действительно index.html, а не переименованный другой файл.',
    },
  ];

  if (requireRedirectPlaceholder) {
    checks.push({
      id: 'tg-redirect-placeholder',
      label: 'Кнопка перехода настроена ({{TG_REDIRECT_URL}})',
      passed: hasRedirectPlaceholder,
      detail: hasRedirectPlaceholder
        ? undefined
        : 'В HTML не найден "{{TG_REDIRECT_URL}}" — кнопка перехода не будет работать. Используйте его как href ссылки-кнопки.',
    });
  }

  checks.push({
    id: 'asset-refs',
    label: 'Ссылки на файлы (css/js/картинки) верны',
    passed: !hasBrokenRefs,
    detail: hasBrokenRefs
      ? `Не найдены в архиве: ${brokenRefs.slice(0, 20).join(', ')}${brokenRefs.length > 20 ? '…' : ''}`
      : undefined,
  });

  return checks;
}

// Определяет, стоит ли на кнопке перехода атрибут data-track="Lead" (баг-репорт пользователя
// 2026-09-08: "не вижу чтобы трекались клики" — оказалось, кнопка была размечена произвольным
// data-track="telegram" вместо ожидаемого системой "Lead"; клики реально уходили на сервер, но
// тихо отклонялись 400-й ошибкой валидации eventName — SDK не логирует неудачные запросы,
// поэтому со стороны клиента выглядело как "всё подключено, но ничего не трекается"). Инструкция
// подключения раньше вообще не упоминала этот атрибут — см. CreateExternalLandingDialog. Ищем
// именно тот <a>, чей href указывает на /tg-redirect ЭТОГО проекта — data-track="Lead" где-то ещё
// на странице не гарантирует, что он стоит на реальной кнопке перехода.
export function hasTrackedJoinButton(html: string, publicToken: string): boolean {
  let found = false;
  const hrefMarker = `/track/${publicToken}/tg-redirect`;

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (name !== 'a') return;
        if (!attribs.href || !attribs.href.includes(hrefMarker)) return;
        if (attribs['data-track'] === 'Lead') found = true;
      },
    },
    { decodeEntities: true },
  );

  try {
    parser.parseComplete(html);
  } catch {
    // см. комментарий у reviewLandingHtml выше — htmlparser2 практически никогда не бросает.
  }

  return found;
}

export function summarizeFailedChecks(checks: LandingReviewCheck[]): string {
  return checks
    .filter((c) => !c.passed)
    .map((c) => c.detail || c.label)
    .join(' ');
}
