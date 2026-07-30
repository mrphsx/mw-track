// Собирается в dist/browser.min.js (track.js) — см. esbuild.config.js.
// Эндпоинты и допустимые поля payload зеркалят apps/api/src/modules/tracking/
// tracking.controller.ts + track-event.dto.ts ровно: тот DTO валидируется с
// forbidNonWhitelisted:true, так что НЕЛЬЗЯ слать произвольные поля (например
// utmMedium/utmContent/utmTerm/referrer — они отсутствуют в DTO и вызовут 400).

(function (window: Window & typeof globalThis, document: Document) {
  const script = document.currentScript as HTMLScriptElement;
  const projectToken = script?.getAttribute('data-project-id');
  const apiBaseUrl = (script?.getAttribute('data-api-url') || '').replace(/\/$/, '');
  // Привязка события к конкретному лендингу (не проекту в целом) — для статистики по
  // отдельным лендингам. Специально НЕ идёт через sessionStorage-мердж ниже (в отличие от
  // fbclid/utm) — landingId привязан к ТЕКУЩЕЙ странице, не должен персистить, если SDK
  // вдруг загрузится на другом лендинге в той же сессии.
  const landingId = script?.getAttribute('data-landing-id') || undefined;
  // Авторедирект (тумблер на лендинге, LandingRendererService.injectTrackingScripts) —
  // страница сразу уводит в Telegram без клика по кнопке. URL уже собран на сервере
  // (тот же /tg-redirect, что и у кнопки), SDK просто трекает Lead и уходит по нему.
  const autoRedirectUrl = script?.getAttribute('data-auto-redirect-url') || undefined;

  // Карта имён query-параметров трекинг-ссылки (пиксель + ad_id/campaign_id/... — запрос
  // пользователя 2026-07-04, "получить ссылку" с кастомными именами параметров, чтобы
  // спай-сервисы конкурентов не палили рекламу по одинаковым ?pixel=&ad_id=). Сервер всегда
  // присылает ПОЛНУЮ разрешённую карту (дефолты + переопределения проекта, см.
  // LandingRendererService/resolveParamMap) — SDK не хранит собственных дефолтов, чтобы не
  // держать третью копию одного и того же списка (бэкенд/фронтенд уже дублируют его между
  // собой за неимением общего пакета в монорепо).
  let paramMap: Record<string, string> = {};
  try {
    paramMap = JSON.parse(script?.getAttribute('data-param-map') || '{}');
  } catch {
    // Атрибут отсутствует/битый — просто не читаем кастомные параметры, остальной трекинг
    // (fbclid/utm/PageView) продолжает работать как обычно.
  }
  // Обратный словарь: фактическое имя параметра в URL -> семантический ключ (adId/pixel/...)
  const paramLookup: Record<string, string> = {};
  for (const [semanticKey, actualName] of Object.entries(paramMap)) {
    paramLookup[actualName] = semanticKey;
  }

  if (!projectToken) {
    console.warn('[TrafficCRM] data-project-id attribute is missing');
    return;
  }
  if (!apiBaseUrl) {
    console.warn('[TrafficCRM] data-api-url attribute is missing');
    return;
  }

  const urlParams = new URLSearchParams(window.location.search);

  // Facebook/TikTok иногда подставляют значение динамического макроса ({{campaign.name}} и
  // т.п.) уже percent-encoded (баг-репорт пользователя 2026-07-25: "кампанию... показывает так
  // scm%7Ccr%7Cvd1%7Cspez1" — реальное имя кампании со знаком "|", закодированным как %7C) —
  // URLSearchParams.get() выше уже сделал ОДИН проход декодирования (стандартное поведение
  // браузера для самого query-string), но если после этого в значении всё ещё остался паттерн
  // %XX — значит исходно было закодировано ДВАЖДЫ, декодируем ещё раз. Для уже нормальных
  // значений (без %XX) — no-op, ничего не меняет.
  function decodeAdMacro(value: string | null): string | null {
    if (!value || !/%[0-9A-Fa-f]{2}/.test(value)) return value;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  // _fbp — ставится базовым пикселем Facebook (fbevents.js, уже подключён на странице через
  // LandingRendererService.injectTrackingScripts), читаем свежее значение прямо в момент клика
  // (запрос пользователя 2026-07-29, сверка с реальным примером конкурента) — не кэшируем в
  // sessionData вместе с fbclid/utm выше, потому что при первом заходе cookie ещё может не
  // успеть проставиться к моменту загрузки этого скрипта, а к моменту клика уже точно есть.
  function readCookie(name: string): string | null {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  // Только поля, которые реально принимает TrackEventDto — utmMedium/utmContent/
  // utmTerm/tgUsername/referrer из исходного черновика SDK сюда не входят.
  const sessionData: Record<string, string | null> = {
    fbclid: urlParams.get('fbclid'),
    ttclid: urlParams.get('ttclid'),
    utmSource: urlParams.get('utm_source'),
    utmCampaign: decodeAdMacro(urlParams.get('utm_campaign')),
  };
  // Пиксель + рекламные макросы — читаем URL по кастомной карте имён проекта (paramLookup),
  // не по дефолтным именам ad_id/campaign_id/... : значение попадает в sessionData под
  // СЕМАНТИЧЕСКИМ ключом (adId/campaignId/...), который и ждёт TrackEventDto на бэкенде,
  // независимо от того, как назывался сам query-параметр в ссылке. pixel/buyerRef — реальные
  // id из нашей системы, никогда не содержат %XX, decodeAdMacro на них — no-op, отдельно не
  // исключаем.
  for (const [actualName, semanticKey] of Object.entries(paramLookup)) {
    sessionData[semanticKey] = decodeAdMacro(urlParams.get(actualName));
  }

  const STORAGE_KEY = '_tcrm_session';
  const existing = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
  const merged: Record<string, string> = { ...existing };
  for (const [k, v] of Object.entries(sessionData)) {
    if (v) merged[k] = v;
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged));

  async function track(eventName: string, extraData: Record<string, unknown> = {}): Promise<void> {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');

    const payload: Record<string, unknown> = {
      eventName,
      pageUrl: window.location.href,
      landingId,
      // fbp — баг-репорт пользователя 2026-07-29: читалось только на клике по кнопке Telegram
      // (withFbp/tgRedirect ниже), но НЕ для обычных браузерных событий (PageView/Lead/
      // InitiateCheckout), которые тоже уходят в Facebook CAPI через TrackingService — читаем
      // свежее значение куки на каждый track()-вызов, а не один раз при загрузке скрипта
      // (как fbclid/utm выше), т.к. _fbp может проставиться fbevents.js уже ПОСЛЕ того, как этот
      // скрипт начал выполняться.
      fbp: readCookie('_fbp'),
      ...stored,
      ...extraData,
    };

    const cleanPayload = Object.fromEntries(Object.entries(payload).filter(([, v]) => v != null && v !== ''));

    try {
      await fetch(`${apiBaseUrl}/track/${projectToken}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanPayload),
        keepalive: true, // продолжать запрос даже при уходе со страницы
      });
    } catch {
      // Трекинг не должен ронять страницу клиента — ошибки сети тихо игнорируются
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => track('PageView'));
  } else {
    track('PageView');
  }

  // Добавляет ?fbp=... к ссылке на /tg-redirect, если cookie уже доступна — сам редирект-
  // эндпоинт (TrackingController.tgRedirect) донашивает её в атрибуцию, донесённую до Telegram-
  // события (запрос пользователя 2026-07-29). Без cookie — просто не трогаем URL, обычный
  // переход как раньше.
  function withFbp(url: string): string {
    const fbp = readCookie('_fbp');
    if (!fbp) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}fbp=${encodeURIComponent(fbp)}`;
  }

  // fetch(..., {keepalive:true}) переживает уход со страницы, поэтому не ждём ответа перед
  // редиректом. fbp тут часто не успевал проставиться (авторедирект срабатывает почти сразу
  // после загрузки страницы, cookie от fbevents.js может ещё не дойти) — баг-репорт пользователя
  // 2026-07-30 (реальное событие без fbp у autoRedirect-лендинга, при том что fbc пришёл
  // нормально, т.к. берётся прямо из URL без зависимости от стороннего скрипта). Раньше здесь
  // редиректили немедленно; теперь — короткое опрос-ожидание cookie максимум FBP_WAIT_MAX_MS,
  // с шагом FBP_WAIT_STEP_MS, редирект уходит сразу, как только cookie появилась, а не всегда
  // ждёт полный потолок. Потолок поднят с 300мс до 3с тем же днём (запрос пользователя: "чтобы
  // fpb точно считывалось, увеличь ещё время... 2-3 секунды") — 300мс оказалось мало для части
  // реальных случаев; 3с — верхняя граница названного диапазона, ради максимальной надёжности
  // ценой более заметной задержки редиректа в худшем случае (среднем случае fbevents.js всё
  // ещё обычно успевает куда раньше потолка, редирект уходит сразу).
  const FBP_WAIT_MAX_MS = 3000;
  const FBP_WAIT_STEP_MS = 50;

  if (autoRedirectUrl) {
    track('Lead');
    if (readCookie('_fbp')) {
      window.location.href = withFbp(autoRedirectUrl);
    } else {
      let waited = 0;
      const poll = window.setInterval(() => {
        waited += FBP_WAIT_STEP_MS;
        if (readCookie('_fbp') || waited >= FBP_WAIT_MAX_MS) {
          window.clearInterval(poll);
          window.location.href = withFbp(autoRedirectUrl);
        }
      }, FBP_WAIT_STEP_MS);
    }
  }

  // <button data-track="Lead">Вступить</button>
  // <a data-track="InitiateCheckout" data-value="99">Купить</a>
  document.addEventListener('click', function (e: MouseEvent) {
    const target = (e.target as HTMLElement).closest('[data-track]') as HTMLElement | null;
    if (!target) return;

    const eventName = target.getAttribute('data-track');
    if (!eventName) return;

    const extra: Record<string, unknown> = {};
    if (target.getAttribute('data-value')) extra.value = parseFloat(target.getAttribute('data-value')!);
    if (target.getAttribute('data-currency')) extra.currency = target.getAttribute('data-currency');
    if (target.getAttribute('data-order-id')) extra.orderId = target.getAttribute('data-order-id');

    track(eventName, extra);
  });

  // Кнопка Telegram (все 4 режима) ведёт статичным href на собственный редирект-эндпоинт
  // (TrackingController.tgRedirect, /track/:publicToken/tg-redirect), который сам решает
  // tg://-ссылку и отвечает 302 — JS-перехват клика здесь в остальном не нужен (раньше был нужен
  // для BOT_DIRECT, чтобы подставить свежий start-код через отдельный POST /tg-start, см.
  // git-историю). data-track="Lead" на кнопке трекается общим обработчиком выше как обычно.
  //
  // Единственное, что добавлено обратно (запрос пользователя 2026-07-29) — дописать ?fbp=
  // прямо перед переходом: cookie читается заново на каждый клик (не один раз при загрузке
  // страницы), поэтому не важно, успел ли fbevents.js проставить её к моменту загрузки SDK —
  // к моменту реального клика уже почти наверняка да. preventDefault только когда cookie
  // реально есть, что менять — иначе обычная навигация по исходному href, без вмешательства.
  document.addEventListener('click', function (e: MouseEvent) {
    const link = (e.target as HTMLElement).closest('a[href*="/tg-redirect"]') as HTMLAnchorElement | null;
    if (!link) return;
    const fbp = readCookie('_fbp');
    if (!fbp) return;
    e.preventDefault();
    window.location.href = withFbp(link.href);
  });

  // Публичный API для ручного использования: window.tcrm.track('Purchase', {value: 99})
  (window as unknown as { tcrm: unknown }).tcrm = {
    track,
    pageView: (data?: Record<string, unknown>) => track('PageView', data || {}),
    lead: (data?: Record<string, unknown>) => track('Lead', data || {}),
    purchase: (amount: number, currency = 'USD', data?: Record<string, unknown>) =>
      track('Purchase', { value: amount, currency, ...(data || {}) }),
  };
})(window, document);
