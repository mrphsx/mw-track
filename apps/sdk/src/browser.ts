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

  // Только поля, которые реально принимает TrackEventDto — utmMedium/utmContent/
  // utmTerm/tgUsername/referrer из исходного черновика SDK сюда не входят.
  const sessionData: Record<string, string | null> = {
    fbclid: urlParams.get('fbclid'),
    ttclid: urlParams.get('ttclid'),
    utmSource: urlParams.get('utm_source'),
    utmCampaign: urlParams.get('utm_campaign'),
  };
  // Пиксель + рекламные макросы — читаем URL по кастомной карте имён проекта (paramLookup),
  // не по дефолтным именам ad_id/campaign_id/... : значение попадает в sessionData под
  // СЕМАНТИЧЕСКИМ ключом (adId/campaignId/...), который и ждёт TrackEventDto на бэкенде,
  // независимо от того, как назывался сам query-параметр в ссылке.
  for (const [actualName, semanticKey] of Object.entries(paramLookup)) {
    sessionData[semanticKey] = urlParams.get(actualName);
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

  // fetch(..., {keepalive:true}) переживает уход со страницы, поэтому не ждём ответа перед
  // редиректом — "срабатывает сразу", без клика по кнопке.
  if (autoRedirectUrl) {
    track('Lead');
    window.location.href = autoRedirectUrl;
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
  // tg://-ссылку и отвечает 302 — JS-перехват клика здесь больше не нужен (раньше был нужен
  // для BOT_DIRECT, чтобы подставить свежий start-код через отдельный POST /tg-start, см.
  // git-историю). data-track="Lead" на кнопке трекается общим обработчиком выше как обычно.

  // Публичный API для ручного использования: window.tcrm.track('Purchase', {value: 99})
  (window as unknown as { tcrm: unknown }).tcrm = {
    track,
    pageView: (data?: Record<string, unknown>) => track('PageView', data || {}),
    lead: (data?: Record<string, unknown>) => track('Lead', data || {}),
    purchase: (amount: number, currency = 'USD', data?: Record<string, unknown>) =>
      track('Purchase', { value: amount, currency, ...(data || {}) }),
  };
})(window, document);
