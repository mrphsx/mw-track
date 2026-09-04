// Собирается в dist/browser.min.js (track.js) — см. esbuild.config.js.
// Эндпоинты и допустимые поля payload зеркалят apps/api/src/modules/tracking/
// tracking.controller.ts + track-event.dto.ts ровно: тот DTO валидируется с
// forbidNonWhitelisted:true, так что НЕЛЬЗЯ слать произвольные поля (например
// utmMedium/utmContent/utmTerm/referrer — они отсутствуют в DTO и вызовут 400).

(function (window: Window & typeof globalThis, document: Document) {
  // Захватывается один раз до любых попыток редиректа (intent://, x-safari-https://, ...) —
  // на некоторых WebView-реализациях присвоение window.location.href = 'intent://...' не
  // отменяет саму навигацию страницы, но JS-видимое значение location.href после этого может
  // остаться равным уже присвоенной intent://-строке, а не реальным URL страницы. Повторное
  // чтение window.location.href для повторной попытки (например, по клику "Open in browser"
  // после того, как автозапуск уже подставил intent://) в таком случае задваивало бы
  // intent://intent://... — баг, пойманный тестом 2026-08-27 перед публикацией.
  const originalHref = window.location.href;
  const script = document.currentScript as HTMLScriptElement;
  const projectToken = script?.getAttribute('data-project-id');
  const apiBaseUrl = (script?.getAttribute('data-api-url') || '').replace(/\/$/, '');
  // Привязка события к конкретному лендингу (не проекту в целом) — для статистики по
  // отдельным лендингам. Специально НЕ идёт через sessionStorage-мердж ниже (в отличие от
  // fbclid/utm) — landingId привязан к ТЕКУЩЕЙ странице, не должен персистить, если SDK
  // вдруг загрузится на другом лендинге в той же сессии.
  const landingId = script?.getAttribute('data-landing-id') || undefined;
  // Группа A/B/n-теста, если этот конкретный заход пришёл через её сплит (запрос пользователя
  // 2026-08-20: "группа лэндингов как отдельная сущность со своей статой разделенной") —
  // отсутствует, если лендинг открыт напрямую (даже если он параллельно СОСТОИТ в какой-то
  // группе через другую ссылку, см. LandingRendererService.injectTrackingScripts).
  const abTestGroupId = script?.getAttribute('data-ab-test-group-id') || undefined;
  // Авторедирект (тумблер на лендинге, LandingRendererService.injectTrackingScripts) —
  // страница сразу уводит в Telegram без клика по кнопке. URL уже собран на сервере
  // (тот же /tg-redirect, что и у кнопки), SDK просто трекает Lead и уходит по нему.
  const autoRedirectUrl = script?.getAttribute('data-auto-redirect-url') || undefined;
  // Отложенный авторедирект (запрос пользователя 2026-08-18, шаблон age-gate-invite с двумя
  // попапами) — вместо немедленного срабатывания на загрузке страницы функция редиректа
  // складывается в window.tcrm.triggerAutoRedirect, и сам template.html вызывает её вручную в
  // нужный момент (переход на попап 2). Без этого атрибута поведение не меняется — редирект
  // срабатывает немедленно, как и раньше, у всех остальных шаблонов.
  const autoRedirectDeferred = script?.getAttribute('data-auto-redirect-defer') === 'true';
  // Доп. инструкции для TikTok (запрос пользователя 2026-08-25, реальный кейс — TikTok Ads
  // показывал "Мы не можем открыть эту страницу непосредственно в TikTok" вместо лендинга,
  // и/или встроенный браузер TikTok молча блокирует переход по tg://-диплинку) — известное,
  // задокументированное ограничение платформы (WKWebView на iOS не даёт JS программно
  // передать управление в реальный Safari — решение Apple, не наше; Android можно эскейпнуть
  // через intent://-навигацию, см. ниже). Строка UA — реальная, подтверждённая на боевом
  // трафике этого проекта ("...musical_ly_2024202030 JsSdk/1.0...AppName/musical_ly...
  // BytedanceWebview/..."), musical_ly — унаследованное от Musical.ly, оригинального
  // приложения до ребрендинга в TikTok. Оба маркера проверяются для надёжности.
  const tiktokBrowserHintEnabled = script?.getAttribute('data-tiktok-browser-hint') === 'true';
  // Отложенный показ подсказки TikTok (запрос пользователя 2026-08-27, "на 2-попаповом лендинге
  // подсказка должна показываться только на втором/финальном попапе") — тот же приём и тот же
  // триггер window.tcrm.triggerAutoRedirect, что и у autoRedirectDeferred выше: template.html
  // ничего менять не нужно, он уже вызывает triggerAutoRedirect ровно в момент открытия попапа
  // 2, а SDK ниже просто заставляет ЭТОТ ЖЕ вызов сначала проверить условие эскейпа в TikTok,
  // и только если оно не сработало — сделать обычный авторедирект (как и раньше).
  const tiktokHintDeferred = script?.getAttribute('data-tiktok-hint-defer') === 'true';
  const hasTikTokUaMarker = /BytedanceWebview|musical_ly/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  // 2026-08-27: реальный TikTok-визит с iOS пришёл БЕЗ musical_ly/BytedanceWebview вообще —
  // подтверждено на боевых данных этого же проекта (настоящие musical_ly-визиты тоже есть, так
  // что маркер не исчез полностью, просто ненадёжен для части сессий). Единственный доступный
  // запасной сигнал именно на iOS: настоящий Mobile Safari всегда заканчивает UA токенами
  // "Version/X Safari/604.1" — это стабильная, давняя конвенция WebKit, а НЕ у встроенных
  // браузеров, которые задают собственный (или урезанный) UA. Поэтому iOS UA без явной метки
  // TikTok, но и без Version/Safari-хвоста, тоже считаем "неопознанным встроенным браузером" —
  // характер проблемы (tg:// не открывается) одинаковый независимо от того, какое именно
  // приложение его показывает.
  //
  // На Android НЕ делаем аналогичного расширения: обычный WebView-маркер "; wv)" присутствует
  // почти в ЛЮБОМ встроенном браузере на Android (проверено на боевых данных — ~88% всего
  // Android-трафика внутри приложений несёт этот маркер безотносительно приложения), так что он
  // не отличает TikTok от Instagram/WhatsApp/др. — расширение по этому признаку срабатывало бы
  // почти на каждом Android-визите из любого приложения, а не именно там, где реально нужно.
  const isUnidentifiedIosInAppBrowser = isIOS && !hasTikTokUaMarker && !/Version\/[\d.]+.*Safari\//.test(navigator.userAgent);
  const isTikTokInAppBrowser = hasTikTokUaMarker || isUnidentifiedIosInAppBrowser;

  // Тексты попапа (запрос пользователя 2026-08-27, "форма для замены текстов как у конкурента")
  // — один JSON-атрибут (LandingRendererService.injectTrackingScripts), каждый ключ независимо
  // опционален: отсутствующий/пустой ключ подставляет свой английский дефолт ниже, а не валит
  // весь попап. Дефолт на английском — явный запрос пользователя, а не наше решение (у всех
  // остальных подсказок SDK, включая старую версию этого же попапа, дефолт был русский).
  let hintTextsOverride: Record<string, string> = {};
  try {
    hintTextsOverride = JSON.parse(script?.getAttribute('data-tiktok-hint-texts') || '{}');
  } catch {
    // невалидный JSON — просто работаем с пустым объектом, ниже всё равно все дефолты на месте
  }
  const HINT_DEFAULTS = {
    title: 'Open in your browser',
    subtitle: 'To join the channel, please open this page in your browser.',
    iosSteps: 'Tap the ⋯ menu at the top-right corner.\nChoose "Open in Browser".',
    androidSteps: 'Tap the ⋯ menu at the top-right corner.\nChoose "Open in browser".',
    openButtonText: 'Open in browser',
    copyButtonText: 'Copy link',
    copiedText: 'Link copied. Paste it into your browser.',
  };
  function hintText(key: keyof typeof HINT_DEFAULTS): string {
    const v = hintTextsOverride[key];
    return typeof v === 'string' && v.trim() ? v : HINT_DEFAULTS[key];
  }

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
  // Иногда рекламная площадка не подставляет часть макросов в конкретной доставке (баг-репорт
  // пользователя 2026-08-20: campaign_id/campaign_name пришли буквально "{{campaign.id}}" и
  // т.п., хотя соседние поля в той же ссылке подставились нормально — сбой на стороне площадки,
  // не обрезка URL) — такое буквальное значение считается отсутствием данных (null), не
  // настоящим значением, тем же приёмом, что и в LandingRendererService (бэкенд). По подстроке,
  // не по полному совпадению — реальная обрезка URL (тот же баг-репорт) может оборвать макрос
  // ПОСЕРЕДИНЕ ("{{site_source_name" без закрывающих "}}"), полное совпадение это бы пропустило.
  const UNSUBSTITUTED_MACRO_PATTERN = /\{\{|\}\}|^__[A-Z]/;

  function decodeAdMacro(value: string | null): string | null {
    if (!value) return value;
    let decoded = value;
    if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        // decodeURIComponent бросает на оборванной %-последовательности — это сама по себе
        // улика обрезки URL (баг-репорт 2026-08-31: значение оборвано на "...%" без хвоста),
        // то же "не настоящее значение", что и {{...}}/__..., поэтому null, а не сырой мусор.
        return null;
      }
    }
    return UNSUBSTITUTED_MACRO_PATTERN.test(decoded) ? null : decoded;
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

  // Персистентный анонимный id визитора чистого веб-сайта (ChannelType.WEBSITE, запрос
  // пользователя 2026-09-03) — localStorage, НЕ sessionStorage (тот выше используется только
  // для внутристраничного merge fbclid/utm и намеренно не переживает новую сессию; идентичность
  // посетителя должна переживать, иначе покупка через день после первого клика не свяжется с
  // той же атрибуцией). Обёрнуто в try/catch — приватный режим Safari/квота могут кинуть,
  // трекинг должен продолжать работать без повторной атрибуции, а не падать.
  function getVisitorId(): string | null {
    try {
      const KEY = '_tcrm_visitor_id';
      let id = localStorage.getItem(KEY);
      if (!id) {
        id =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `v_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(KEY, id);
      }
      return id;
    } catch {
      return null;
    }
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
      abTestGroupId,
      // fbp — баг-репорт пользователя 2026-07-29: читалось только на клике по кнопке Telegram
      // (withFbp/tgRedirect ниже), но НЕ для обычных браузерных событий (PageView/Lead/
      // InitiateCheckout), которые тоже уходят в Facebook CAPI через TrackingService — читаем
      // свежее значение куки на каждый track()-вызов, а не один раз при загрузке скрипта
      // (как fbclid/utm выше), т.к. _fbp может проставиться fbevents.js уже ПОСЛЕ того, как этот
      // скрипт начал выполняться.
      fbp: readCookie('_fbp'),
      visitorId: getVisitorId(),
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

  // Публичный API для ручного использования: window.tcrm.track('Purchase', {value: 99}).
  // Определяется здесь (а не в самом конце файла, как раньше) — отложенному авторедиректу
  // (autoRedirectDeferred, ниже) нужно дописать в этот же объект triggerAutoRedirect ДО того,
  // как выполнение дойдёт до конца скрипта.
  const tcrm: Record<string, unknown> = {
    track,
    pageView: (data?: Record<string, unknown>) => track('PageView', data || {}),
    lead: (data?: Record<string, unknown>) => track('Lead', data || {}),
    // idempotencyKey — авто из orderId, если явно не передан (запрос пользователя 2026-09-03,
    // "клиент делает покупку" на обычном сайте): без стабильного ключа повторный fetch
    // (keepalive при уходе со страницы, обновление "спасибо за заказ") может задвоить покупку.
    // Дедуп по-настоящему работает только если сайт передаёт стабильный orderId — это
    // ограничение задокументировано в интеграции, не решается только на стороне SDK.
    purchase: (amount: number, currency = 'USD', data?: Record<string, unknown>) => {
      const d = data || {};
      const idempotencyKey = d.idempotencyKey || (d.orderId ? `${projectToken}_order_${d.orderId}` : undefined);
      return track('Purchase', { value: amount, currency, ...d, idempotencyKey });
    },
    // Публичный геттер persisted visitorId (запрос пользователя 2026-09-03) — нужен сайтам,
    // которые шлют "Покупку" со своего бэкенда (серверная интеграция, надёжнее браузерного
    // вызова) — их фронтенд должен передать этот id своему бэкенду (скрытым полем формы,
    // fetch-заголовком и т.п.), чтобы бэкенд включил его в подписанный POST
    // /track/server/:projectId/event и покупка привязалась к тому же посетителю, что и его
    // предыдущие PageView/Lead.
    getVisitorId: () => getVisitorId(),
  };
  (window as unknown as { tcrm: unknown }).tcrm = tcrm;

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

  // Предзагрузка готовой tg:// + https:// ссылки (запрос пользователя 2026-08-31, "возьмём у
  // конкурента полезные наработки" — их скрипт заранее дёргает свой редирект-эндпоинт с
  // ?format=json по клику на "Join", чтобы сама навигация по тапу была мгновенной, без сетевого
  // round-trip). У нас нет отдельной кнопки "Join" перед авто-эскейпом TikTok — запускается сразу
  // на детекте TikTok+Android (см. runTiktokEscapeOrAutoRedirect ниже), параллельно с уже
  // синхронной попыткой обычного эскейпа, не блокируя и не задерживая её. Результат нужен только
  // кнопке "Открыть" в фоллбэк-оверлее, который (если вообще покажется) появляется не раньше чем
  // через 1.5с — к этому моменту запрос почти наверняка уже завершился. Кэшируется в rejected-
  // safe промисе (.catch(()=>null)), чтобы повторный вызов не плодил новых запросов и никогда не
  // падал необработанным исключением.
  let tgLinkPromise: Promise<{ tg: string | null; https: string | null } | null> | null = null;
  function prefetchTelegramLink(): Promise<{ tg: string | null; https: string | null } | null> {
    if (tgLinkPromise) return tgLinkPromise;
    if (!autoRedirectUrl) return Promise.resolve(null);
    const base = withFbp(autoRedirectUrl);
    const sep = base.includes('?') ? '&' : '?';
    tgLinkPromise = fetch(`${base}${sep}format=json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    return tgLinkPromise;
  }

  // Прямой Android-intent в приложение Telegram (подсмотрено у конкурента, запрос пользователя
  // 2026-08-31) — явный package=org.telegram.messenger резолвится Android'ом без диалога выбора
  // приложения (в отличие от нашего generic-эскейпа ниже, который открывает НЕ Telegram, а любой
  // внешний браузер, откуда tg:// уже пришлось бы переоткрывать вторым шагом). S.browser_fallback_
  // url — если Telegram не установлен, Android сам откроет https-ссылку в обычном браузере, без
  // нашего собственного повторного редиректа.
  function buildTelegramPackageIntent(tg: string, https: string | null): string | null {
    try {
      const rest = tg.replace(/^tg:\/\//, '');
      let intent = `intent://${rest}#Intent;scheme=tg;package=org.telegram.messenger`;
      if (https) intent += `;S.browser_fallback_url=${encodeURIComponent(https)}`;
      intent += ';end';
      return intent;
    } catch {
      return null;
    }
  }

  // Прежний generic-эскейп (открыть ЛЮБОЙ внешний браузер, без прямого прицела на Telegram) —
  // остаётся как есть и как fallback, если предзагруженная tg-ссылка недоступна (сеть, эндпоинт
  // не ответил): категория BROWSABLE — задокументированный Google способ "открыть в браузере",
  // который WebView-реализации обычно пропускают (в отличие от кастомных схем вроде tg://).
  function genericAndroidEscape(): string {
    const target = originalHref.replace(/^https?:\/\//, '');
    return `intent://${target}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end`;
  }

  // fetch(..., {keepalive:true}) переживает уход со страницы, поэтому не ждём ответа перед
  // редиректом. Раньше здесь был переменный по длительности вейт: редирект сразу, если _fbp уже
  // есть, иначе опрос-ожидание до 3с (баг-репорт 2026-07-30 — fbp часто не успевал проставиться
  // при мгновенном авторедиректе). Запрос пользователя 2026-08-19 ("всё равно увеличь время до
  // авторедиректа, поставь чтобы было 2 секунды ВСЕГДА") — заменено на фиксированную паузу без
  // условий: не влияет на то, что баер/кампания и т.п. читаются сервером ещё до этого скрипта
  // (см. разбор бага в LandingRendererService), это просто явная, предсказуемая пауза перед
  // уходом с лендинга, независимо от состояния cookie.
  const AUTO_REDIRECT_DELAY_MS = 2000;

  function fireAutoRedirect(): void {
    track('Lead');
    window.setTimeout(() => {
      window.location.href = withFbp(autoRedirectUrl!);
    }, AUTO_REDIRECT_DELAY_MS);
  }

  // Копирует текущий URL в буфер — основной рабочий путь эскейпа на iOS (кнопка "Open in
  // browser" ниже — best-effort попытка через window.open, которую часть встроенных браузеров
  // всё равно блокирует, а Copy Link работает предсказуемо в любом WebView с Clipboard API или
  // старым document.execCommand('copy') — фоллбэк на случай урезанного/старого WebView TikTok,
  // тот же класс проблемы, что и с UA-детектом выше).
  function copyCurrentUrl(onDone: () => void): void {
    // originalHref, не window.location.href — на Android этот оверлей часто рендерится ПОСЛЕ
    // уже попытанного intent://-редиректа (см. комментарий у originalHref выше), к тому моменту
    // location.href на некоторых WebView может уже отражать саму intent://-строку, а не
    // реальный адрес лендинга — копировать в буфер нужно именно исходную ссылку.
    const url = originalHref;
    function fallback(): void {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('style', 'position:fixed;top:0;left:0;opacity:0;');
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        // некуда деваться — просто не показываем подтверждение, если и это не сработало
      }
      document.body.removeChild(ta);
      onDone();
    }
    const clipboard = (navigator as Navigator & { clipboard?: { writeText(text: string): Promise<void> } }).clipboard;
    if (clipboard?.writeText) {
      clipboard.writeText(url).then(onDone, fallback);
    } else {
      fallback();
    }
  }

  // Показывает на весь экран подсказку "открой в браузере" (запрос пользователя 2026-08-27,
  // "полностью как у конкурента" — редактируемые тексты + кнопка копирования ссылки с
  // подтверждением и стрелкой-указателем, а не просто статичный текст). Единственный НАДЁЖНЫЙ
  // путь на iOS — вручную открыть Safari и вставить ссылку (Apple не даёт JS форсировать переход,
  // см. комментарий у isTikTokInAppBrowser выше); "Open in browser" — best-effort попытка на
  // случай, если конкретный WebView всё же пропустит window.open. Простой self-contained оверлей
  // без внешних шрифтов/иконок — скрипт исполняется на произвольных сторонних доменах. Строится
  // через DOM API (не innerHTML с конкатенацией строк) — title/subtitle/шаги приходят из
  // пользовательских настроек лендинга (TiktokHintTextsDto), а не только из хардкода, так что
  // безопаснее не собирать HTML руками.
  // stepsText — 'iosSteps' или 'androidSteps' в зависимости от платформы (см. вызов ниже).
  function showTikTokBrowserHintOverlay(stepsKey: 'iosSteps' | 'androidSteps'): void {
    function render(): void {
      // Баннер снизу экрана, а не полноэкранная модалка с тёмной подложкой (запрос пользователя
      // 2026-08-27: "подсказка перекрывает сам лэндинг" — раньше inset:0 + rgba(0,0,0,.85) целиком
      // прятал контент лендинга под собой). Лендинг остаётся полностью видимым и скроллируемым
      // над баннером — никакого затемняющего слоя на весь экран.
      const overlay = document.createElement('div');
      overlay.setAttribute(
        'style',
        'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;' +
          'max-height:75vh;overflow-y:auto;' +
          'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
      );

      const card = document.createElement('div');
      card.setAttribute(
        'style',
        'background:#fff;border-radius:20px 20px 0 0;padding:24px 24px calc(24px + env(safe-area-inset-bottom, 0px));' +
          'text-align:center;box-shadow:0 -8px 32px rgba(0,0,0,.35);',
      );

      const icon = document.createElement('div');
      icon.setAttribute('style', 'font-size:40px;line-height:1;margin-bottom:12px;');
      icon.textContent = '⋯';
      card.appendChild(icon);

      const title = document.createElement('div');
      title.setAttribute('style', 'font-size:17px;font-weight:600;color:#111;margin-bottom:8px;');
      title.textContent = hintText('title');
      card.appendChild(title);

      const subtitle = document.createElement('div');
      subtitle.setAttribute('style', 'font-size:14px;line-height:1.5;color:#555;margin-bottom:16px;');
      subtitle.textContent = hintText('subtitle');
      card.appendChild(subtitle);

      const stepsList = document.createElement('ol');
      stepsList.setAttribute('style', 'text-align:left;font-size:13px;line-height:1.6;color:#333;margin:0 0 20px;padding-left:20px;');
      hintText(stepsKey)
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((step) => {
          const li = document.createElement('li');
          li.textContent = step;
          stepsList.appendChild(li);
        });
      card.appendChild(stepsList);

      const buttonRow = document.createElement('div');
      buttonRow.setAttribute('style', 'display:flex;flex-direction:column;gap:8px;');

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.textContent = hintText('openButtonText');
      openBtn.setAttribute(
        'style',
        'appearance:none;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:600;' +
          'background:#1F4E9C;color:#fff;cursor:pointer;',
      );
      openBtn.addEventListener('click', () => {
        try {
          if (isIOS) {
            // window.open(...) молча ничего не делает в большинстве встроенных браузеров —
            // подтверждено реальным репортом пользователя 2026-08-27 ("кнопка вообще не
            // работает"). x-safari-https:// — полудокументированная, но реальная и рабочая
            // (проверено на LinkedIn-подобных встроенных браузерах, см. исследование перед
            // внедрением) схема, которую сама iOS резолвит в Safari — лучший из доступных
            // best-effort вариантов на iOS, гарантий нет (конкретно TikTok может блокировать
            // и её, как и tg://), поэтому Copy Link ниже остаётся единственным НАДЁЖНЫМ путём.
            const u = new URL(originalHref);
            window.location.href = `x-safari-https://${u.host}${u.pathname}${u.search}${u.hash}`;
          } else {
            // Android: если предзагрузка (запущена ещё на входе в TikTok-ветку, см.
            // prefetchTelegramLink выше) успела вернуть готовую tg-ссылку — открываем ПРЯМОЙ
            // intent в приложение Telegram (один шаг, вместо "эскейп в браузер → тот сам
            // откроет tg://" как раньше). Оверлей появляется не раньше чем через 1.5с после
            // старта запроса, так что данные почти наверняка уже готовы. Без них — прежний
            // generic-эскейп, тот же, что уже пытался открыться на автозапуске.
            (tgLinkPromise || prefetchTelegramLink()).then((data) => {
              const packageIntent = data?.tg ? buildTelegramPackageIntent(data.tg, data.https) : null;
              window.location.href = packageIntent || genericAndroidEscape();
            });
          }
        } catch {
          // у пользователя всё ещё есть кнопка "Copy link" ниже как гарантированный путь
        }
      });
      buttonRow.appendChild(openBtn);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.textContent = hintText('copyButtonText');
      copyBtn.setAttribute(
        'style',
        'appearance:none;border:1px solid #ddd;border-radius:10px;padding:12px;font-size:14px;font-weight:600;' +
          'background:#fff;color:#111;cursor:pointer;',
      );
      buttonRow.appendChild(copyBtn);
      card.appendChild(buttonRow);
      overlay.appendChild(card);

      // Стрелка-указатель на "···" в правом верхнем углу экрана (там, где реально находится
      // меню встроенного браузера) — появляется вместе с подтверждением копирования, не раньше.
      const arrow = document.createElement('div');
      arrow.setAttribute(
        'style',
        'position:fixed;top:8px;right:16px;z-index:2147483647;display:none;flex-direction:column;align-items:flex-end;' +
          'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
      );
      const arrowGlyph = document.createElement('div');
      arrowGlyph.setAttribute('style', 'font-size:28px;color:#fff;line-height:1;text-shadow:0 1px 4px rgba(0,0,0,.6);');
      arrowGlyph.textContent = '↑';
      const arrowLabel = document.createElement('div');
      arrowLabel.setAttribute(
        'style',
        'margin-top:4px;max-width:200px;background:#fff;color:#111;border-radius:10px;padding:8px 12px;' +
          'font-size:12px;line-height:1.4;text-align:right;box-shadow:0 2px 12px rgba(0,0,0,.3);',
      );
      arrowLabel.textContent = hintText('copiedText');
      arrow.appendChild(arrowGlyph);
      arrow.appendChild(arrowLabel);
      document.body.appendChild(arrow);

      copyBtn.addEventListener('click', () => {
        copyBtn.disabled = true;
        copyCurrentUrl(() => {
          arrow.style.display = 'flex';
          copyBtn.textContent = hintText('copiedText');
        });
      });

      document.body.appendChild(overlay);

      // Резервируем снизу body место под баннер (запрос пользователя 2026-08-27, "подсказка
      // всё ещё перекрывает лэндинг снизу" — баннер плавает поверх фикс-контента вместо того,
      // чтобы потеснить его). Многие шаблоны (в т.ч. age-gate-invite) центрируют карточку
      // flex'ом на всю высоту body — добавленный снизу padding пересчитывает центр в
      // оставшемся пространстве НАД баннером, а не прячет контент под ним; для обычных
      // прокручиваемых страниц просто добавляет запас внизу документа. Измеряется ПОСЛЕ
      // appendChild — до этого overlay не в документе, getBoundingClientRect() вернул бы 0.
      // body.style.paddingBottom не откатываем: оверлей — терминальное состояние этой загрузки.
      const existingPaddingBottom = window.getComputedStyle(document.body).paddingBottom;
      document.body.style.paddingBottom = `calc(${existingPaddingBottom} + ${overlay.getBoundingClientRect().height}px)`;
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', render);
    } else {
      render();
    }
  }

  // Эскейп из встроенного браузера TikTok (запрос пользователя 2026-08-25) + обычный
  // авторедирект объединены в одну функцию: эскейп проверяется ДО авторедиректа и, если
  // сработал, заменяет его целиком на этой загрузке — обычный tg://-переход внутри TikTok либо
  // тоже заблокирован, либо и есть первопричина блокировки (см. полный разбор в CLAUDE.md/
  // памяти). Как только человек окажется в реальном браузере, страница откроется заново уже без
  // isTikTokInAppBrowser, и авторедирект сработает как обычно.
  function runTiktokEscapeOrAutoRedirect(): void {
    if (tiktokBrowserHintEnabled && isTikTokInAppBrowser) {
      if (isIOS) {
        // iOS: WKWebView внутри TikTok не даёт JS форсировать переход в Safari — это ограничение
        // самой платформы (подтверждено несколькими независимыми источниками), единственный
        // рабочий путь — подсказать пользователю сделать это руками.
        showTikTokBrowserHintOverlay('iosSteps');
      } else {
        // Android: intent://-навигация с category=BROWSABLE — задокументированный Google способ
        // "открыть в браузере", который WebView-реализации обычно пропускают (в отличие от
        // кастомных схем вроде tg://, которые именно поэтому блокируются как потенциальный угон
        // в чужое приложение без ведома пользователя). Запрос пользователя 2026-08-27 — если этот
        // авто-эскейп по какой-то причине не сработал (страница всё ещё видима спустя 1.5с — тот
        // же класс WebView-квирков, что и обнаруженный на iOS UA-детект), показываем тот же
        // оверлей с инструкцией как на iOS, вместо молчаливого зависания. Слушатели снимаются,
        // если уход со страницы всё же случился (visibilitychange/pagehide) — тогда фоллбэк не
        // должен всплыть.
        // Предзагружаем прямую tg-ссылку в фоне (запрос пользователя 2026-08-31) — нужна только
        // кнопке "Открыть" в фоллбэк-оверлее ниже, если он вообще покажется; не блокирует и не
        // задерживает сам синхронный эскейп сразу под ней.
        prefetchTelegramLink();
        let escaped = false;
        const onLeave = () => {
          escaped = true;
        };
        document.addEventListener('visibilitychange', onLeave);
        window.addEventListener('pagehide', onLeave);
        window.location.href = genericAndroidEscape();
        window.setTimeout(() => {
          document.removeEventListener('visibilitychange', onLeave);
          window.removeEventListener('pagehide', onLeave);
          if (!escaped) showTikTokBrowserHintOverlay('androidSteps');
        }, 1500);
      }
      return;
    }
    if (autoRedirectUrl) fireAutoRedirect();
  }

  // Отложенный запуск (запрос пользователя 2026-08-27, "на 2-попаповом лендинге подсказка
  // должна показываться только на втором попапе") — тот же приём, что и у отдельного
  // autoRedirectDeferred (шаблон age-gate-invite): template.html уже вызывает
  // window.tcrm.triggerAutoRedirect() ровно в момент открытия попапа 2, ничего в самом шаблоне
  // менять не нужно — здесь просто решаем, вызвать runTiktokEscapeOrAutoRedirect() сразу на
  // загрузке (обычные шаблоны, как и раньше) или положить её в window.tcrm.triggerAutoRedirect и
  // ждать явного вызова (если ЛИБО эскейп TikTok, ЛИБО обычный авторедирект помечены deferred).
  if (tiktokHintDeferred || autoRedirectDeferred) {
    tcrm.triggerAutoRedirect = runTiktokEscapeOrAutoRedirect;
  } else {
    runTiktokEscapeOrAutoRedirect();
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
})(window, document);
