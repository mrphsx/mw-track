// Собирается в dist/browser.min.js (track.js) — см. esbuild.config.js.
// Эндпоинты и допустимые поля payload зеркалят apps/api/src/modules/tracking/
// tracking.controller.ts + track-event.dto.ts ровно: тот DTO валидируется с
// forbidNonWhitelisted:true, так что НЕЛЬЗЯ слать произвольные поля (например
// utmMedium/utmContent/utmTerm/referrer — они отсутствуют в DTO и вызовут 400).

(function (window: Window & typeof globalThis, document: Document) {
  const script = document.currentScript as HTMLScriptElement;
  const projectToken = script?.getAttribute('data-project-id');
  const apiBaseUrl = (script?.getAttribute('data-api-url') || '').replace(/\/$/, '');

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

  async function generateTelegramStartCode(): Promise<string | null> {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');

    const cacheKey = '_tcrm_start_' + projectToken;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return cached;

    try {
      const response = await fetch(`${apiBaseUrl}/track/${projectToken}/tg-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stored),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { startCode: string };
      sessionStorage.setItem(cacheKey, data.startCode);
      return data.startCode;
    } catch {
      return null;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => track('PageView'));
  } else {
    track('PageView');
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

  // <a data-tg-bot="mybot" href="https://t.me/mybot?start=...">Перейти в Telegram</a>
  // Только явный непустой data-tg-bot — это режимы лендинга, где переход идёт ЧЕРЕЗ бота
  // (BOT_DIRECT/PRIVATE_CHANNEL_REQUEST, см. LandingRendererService.buildTelegramLink),
  // и кнопке нужен свежий start-код для атрибуции на момент клика (sessionStorage может
  // успеть накопить данные, которых не было при серверном рендере страницы).
  // Прямые режимы (канал/личка) этот атрибут не рисуют вообще — раньше здесь был
  // фоллбэк на любой href с "t.me", который ошибочно пытался бы переписать и эти
  // ссылки тоже, требуя лишний async-запрос там, где он не нужен и не имеет смысла
  // (у канала/личного аккаунта нет start-параметра).
  document.addEventListener('click', async function (e: MouseEvent) {
    const target = (e.target as HTMLElement).closest('[data-tg-bot]') as HTMLElement | null;
    if (!target) return;

    const botUsername = target.getAttribute('data-tg-bot');
    if (!botUsername) return;

    e.preventDefault();
    track('Lead');

    const startCode = await generateTelegramStartCode();
    const tgUrl = startCode ? `https://t.me/${botUsername}?start=${startCode}` : `https://t.me/${botUsername}`;
    window.open(tgUrl, '_blank');
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
