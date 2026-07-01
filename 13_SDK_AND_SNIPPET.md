# 13 — SDK: JS Snippet, REST API документация, npm пакет

## ✅ РЕАЛИЗОВАНО (Фаза 2, шаг 2.4, 2026-06-28)

Реализовано в `apps/sdk/`. Ниже — реальные отличия от иллюстративного псевдокода этого
документа, найденные при стыковке с уже существующим (с шага 1.7) `tracking.controller.ts`:

- **`EventData`/`EventName` в этом доке шире, чем реально принимает API.**
  `TrackEventDto` (apps/api) валидируется с `forbidNonWhitelisted: true` — лишнее поле не
  отбрасывается тихо, а валит запрос 400-кой. У `TrackEventDto` нет полей `utmMedium`,
  `utmContent`, `utmTerm`, `tgUsername`, `referrer` (они были в черновике типов этого дока) и
  `eventName` — фиксированный список (`PageView`/`Lead`/`Subscribe`/`Purchase`/
  `InitiateCheckout`/`Click`), не произвольная строка. Реальные `apps/sdk/src/types.ts` зеркалят
  `TrackEventDto` ровно, а не черновик из этого дока — иначе SDK слал бы запросы, которые
  собственный бэкенд гарантированно отклонит.
- **Ответ сервера — не `{success,data:{eventId}}`.** В этом API только ошибки оборачиваются в
  `{success:false,error:{...}}` (`HttpExceptionFilter`); успешный ответ — то, что вернул
  контроллер, без обёртки. `trackServerEvent`/`trackEvent` возвращают `{eventId}` напрямую.
  `TrackClient.event()` читает `result.eventId`, не `result.data.eventId`.
- **Сборка — esbuild, не rollup** (так в явном виде написано в 15_PHASES.md чеклисте для этого
  шага; rollup-конфиг ниже в этом файле — нереализованный черновик из исходной спеки). Реальный
  `apps/sdk/esbuild.config.js` собирает 3 файла: `dist/browser.min.js` (iife, minify),
  `dist/index.js` (cjs), `dist/index.esm.js` (esm); `tsc --emitDeclarationOnly` отдельно даёт `.d.ts`.
- **Реальный публичный CDN-бакет, отдельный от приватного бакета лендингов.** `MINIO_CDN_BUCKET`
  (`trafficcrm-cdn`) — с публичной read-policy, в отличие от `MINIO_BUCKET` (кастомные ZIP-лендинги
  из шага 2.3, приватный, отдаётся только через API). `apps/sdk/scripts/publish-cdn.js` создаёт
  бакет, выставляет policy и заливает `track.js` — реальный аналог `mc cp ...` из этого дока, но
  через `minio` SDK напрямую, не через `mc` CLI. `CDN_URL` теперь указывает на путь бакета
  (`http://localhost:9000/trafficcrm-cdn` в dev), не на корень MinIO. В проде — отдельный
  `cdn.yourdomain.com` vhost в `infra/nginx/conf.d/main.conf`, проксирующий на `minio:9000/trafficcrm-cdn/`.
- **`data-api-url` теперь обязателен в сниппете.** track.js хостится на CDN-домене, отдельном от
  API origin — без `data-api-url` browser.ts не знает, куда стучаться (предупреждает в консоль и
  не работает, без молчаливого фолбэка на несуществующий `api.trafficcrm.io`).
  `ProjectsService.getSnippet`/`LandingRendererService.injectTrackingScripts` оба теперь
  подставляют его из `${API_URL}/api/v1`.
- **PHP/Python примеры — теперь реально часть `getSnippet()`**, не только в этом markdown-файле:
  возвращаются как `phpExample`/`pythonExample` и показаны на вкладке "Интеграция" в табах
  (Node.js SDK / PHP / Python), каждый со своей кнопкой копирования.
- **`TestEventSender`/`POST /tracking/test/:projectId` из конца этого дока не реализованы** —
  не входили в явный чеклист 15_PHASES.md для этого шага, осознанно не строились.

**Что проверено живым тестом:** серверный SDK (`TrackClient`) — реальный HMAC-подписанный запрос
к работающему API (`purchase`/`lead`), оба создали реальные строки `TrackingEvent`; отдельно
проверено, что заведомо неверный `secretKey` корректно отклоняется (`success:false`). PHP- и
Python-примеры из `getSnippet()` запущены как настоящий код (`php script.php`,
venv+`requests`) — оба реально создали `TrackingEvent` через тот же эндпоинт. Браузерный
`track.js`, реально загруженный с публичного CDN-бакета (не из исходников, а скачанный файл),
подключён на статической HTML-странице на ДРУГОМ origin, чем API (имитация внешнего лендинга на
сервере клиента) — авто-`PageView` при загрузке и `Lead` по клику `[data-track]` подтверждены
через перехват сетевых запросов и прямую проверку строк в БД (включая сохранённый `fbclid` из
query-параметров через `sessionStorage`); клик по `[href*="t.me"]`-ссылке вызвал `tg-start`,
открыл `https://t.me/<bot>?start=<code>` и положил в Redis `start:<code>` JSON с тем же набором
полей (`fbclid`/`utmSource`/`utmCampaign`), что читает `TelegramProvider.handleStart()` (шаг 1.5) —
подтверждает, что атрибуция с внешнего лендинга реально доходит до Telegram-бота. UI вкладки
"Интеграция" (Node/PHP/Python табы, кнопки копирования) проверен в реальном браузере (Playwright) —
без ошибок консоли. Все тестовые компании/проекты/события удалены после проверки.

## Задача для Claude Code (исходная, ниже — иллюстративный черновик, не буквальный код)
Реализуй полный SDK пакет для внешних лендингов на серверах клиентов.

---

## Структура apps/sdk/

```
apps/sdk/
├── src/
│   ├── index.ts          — Node.js / серверный SDK
│   ├── browser.ts        — Browser bundle (собирается в track.js)
│   └── types.ts          — Типы
├── package.json
├── tsconfig.json
└── rollup.config.js      — сборка browser bundle
```

---

## package.json для SDK

```json
{
  "name": "@trafficcrm/sdk",
  "version": "1.0.0",
  "description": "TrafficCRM tracking SDK",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "browser": "dist/browser.min.js",
  "scripts": {
    "build": "tsc && rollup -c",
    "dev": "tsc --watch"
  },
  "dependencies": {},
  "devDependencies": {
    "rollup": "^4.0.0",
    "@rollup/plugin-typescript": "^11.0.0",
    "@rollup/plugin-terser": "^0.4.0",
    "typescript": "^5.3.0"
  }
}
```

---

## Типы (types.ts)

```typescript
// apps/sdk/src/types.ts

export type EventName =
  | 'PageView'
  | 'Lead'
  | 'Subscribe'
  | 'Purchase'
  | 'InitiateCheckout'
  | string; // произвольные кастомные события

export interface EventData {
  // Атрибуция
  fbclid?: string;
  ttclid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;

  // Пользователь (серверная сторона — указывать обязательно)
  email?: string;
  phone?: string;

  // Страница
  pageUrl?: string;
  referrer?: string;

  // Покупка
  value?: number;
  currency?: string;
  orderId?: string;

  // Telegram
  tgUserId?: string;
  tgUsername?: string;

  // Дедупликация
  idempotencyKey?: string;

  // Произвольные данные
  [key: string]: any;
}

export interface TrackClientOptions {
  projectId: string;
  secretKey: string;
  apiUrl?: string;
  debug?: boolean;
}

export interface TrackResult {
  eventId: string;
  success: boolean;
}
```

---

## Серверный SDK (index.ts) — для Node.js

```typescript
// apps/sdk/src/index.ts
import { createHmac } from 'crypto';
import { EventData, EventName, TrackClientOptions, TrackResult } from './types';

export class TrackClient {
  private readonly projectId: string;
  private readonly secretKey: string;
  private readonly apiUrl: string;
  private readonly debug: boolean;

  constructor(options: TrackClientOptions) {
    if (!options.projectId) throw new Error('[TrafficCRM] projectId is required');
    if (!options.secretKey) throw new Error('[TrafficCRM] secretKey is required');

    this.projectId = options.projectId;
    this.secretKey = options.secretKey;
    this.apiUrl = options.apiUrl || 'https://api.trafficcrm.io/api/v1';
    this.debug = options.debug || false;
  }

  /**
   * Отправить произвольное событие
   */
  async event(eventName: EventName, data: EventData = {}): Promise<TrackResult> {
    const timestamp = Date.now().toString();

    const payload: Record<string, any> = {
      eventName,
      timestamp: new Date().toISOString(),
      ...data,
    };

    const body = JSON.stringify(payload);

    // HMAC-SHA256 подпись
    const signature = 'sha256=' + createHmac('sha256', this.secretKey)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    if (this.debug) {
      console.log(`[TrafficCRM] Sending event: ${eventName}`, payload);
    }

    try {
      const response = await fetch(
        `${this.apiUrl}/track/server/${this.projectId}/event`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': signature,
            'X-Timestamp': timestamp,
          },
          body,
        }
      );

      if (!response.ok) {
        const error = await response.json();
        if (this.debug) {
          console.error('[TrafficCRM] API error:', error);
        }
        return { eventId: '', success: false };
      }

      const result = await response.json();
      
      if (this.debug) {
        console.log(`[TrafficCRM] Event sent successfully:`, result.data);
      }
      
      return { eventId: result.data.eventId, success: true };

    } catch (error) {
      if (this.debug) {
        console.error('[TrafficCRM] Network error:', error);
      }
      return { eventId: '', success: false };
    }
  }

  // Удобные методы

  async pageView(data?: Partial<EventData>): Promise<TrackResult> {
    return this.event('PageView', data);
  }

  async lead(data?: Partial<EventData>): Promise<TrackResult> {
    return this.event('Lead', data);
  }

  async subscribe(data?: Partial<EventData>): Promise<TrackResult> {
    return this.event('Subscribe', data);
  }

  async initiateCheckout(value?: number, currency = 'USD', data?: Partial<EventData>): Promise<TrackResult> {
    return this.event('InitiateCheckout', { value, currency, ...data });
  }

  async purchase(
    amount: number,
    currency = 'USD',
    data?: Partial<EventData>
  ): Promise<TrackResult> {
    return this.event('Purchase', {
      value: amount,
      currency,
      ...data,
    });
  }
}

export type { EventData, EventName, TrackClientOptions, TrackResult };
```

---

## Браузерный SDK (browser.ts) — собирается в track.js

```typescript
// apps/sdk/src/browser.ts

(function (window: Window & typeof globalThis, document: Document) {
  const script = document.currentScript as HTMLScriptElement;
  const projectToken = script?.getAttribute('data-project-id');
  const apiBaseUrl = script?.getAttribute('data-api-url') || 'https://api.trafficcrm.io/api/v1';

  if (!projectToken) {
    console.warn('[TrafficCRM] data-project-id attribute is missing');
    return;
  }

  // Парсить URL параметры
  const urlParams = new URLSearchParams(window.location.search);

  const sessionData: Record<string, string | null> = {
    fbclid: urlParams.get('fbclid'),
    ttclid: urlParams.get('ttclid'),
    utmSource: urlParams.get('utm_source'),
    utmMedium: urlParams.get('utm_medium'),
    utmCampaign: urlParams.get('utm_campaign'),
    utmContent: urlParams.get('utm_content'),
    utmTerm: urlParams.get('utm_term'),
  };

  // Сохранить в sessionStorage чтобы переживало навигацию
  const STORAGE_KEY = '_tcrm_session';
  
  const existing = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
  // Merge: новые параметры имеют приоритет только если они не null
  const merged: Record<string, string> = { ...existing };
  for (const [k, v] of Object.entries(sessionData)) {
    if (v) merged[k] = v;
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged));

  /**
   * Основная функция отправки события
   */
  async function track(eventName: string, extraData: Record<string, any> = {}): Promise<void> {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');

    const payload = {
      eventName,
      pageUrl: window.location.href,
      referrer: document.referrer,
      ...stored,
      ...extraData,
    };

    // Убрать null/undefined поля
    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([_, v]) => v != null && v !== '')
    );

    try {
      await fetch(`${apiBaseUrl}/track/${projectToken}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanPayload),
        keepalive: true, // важно: продолжать запрос даже при уходе со страницы
      });
    } catch {
      // Тихо игнорировать ошибки трекинга
    }
  }

  /**
   * Генерировать уникальный start код для Telegram deep link
   * Сохраняет fbclid/ttclid/utm на сервере, связывает с Telegram пользователем
   */
  async function generateTelegramStartCode(): Promise<string | null> {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    
    // Кэшировать start code в sessionStorage (не генерировать каждый раз)
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
      
      const { data } = await response.json();
      sessionStorage.setItem(cacheKey, data.startCode);
      return data.startCode;
    } catch {
      return null;
    }
  }

  /**
   * Автоматически PageView при загрузке
   */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => track('PageView'));
  } else {
    track('PageView');
  }

  /**
   * Автоматически отслеживать клики на элементы с data-track
   * <button data-track="Lead">Вступить</button>
   * <a data-track="InitiateCheckout" data-value="99">Купить</a>
   */
  document.addEventListener('click', function (e: MouseEvent) {
    const target = (e.target as HTMLElement).closest('[data-track]') as HTMLElement | null;
    if (!target) return;

    const eventName = target.getAttribute('data-track');
    if (!eventName) return;

    const extra: Record<string, any> = {};
    if (target.getAttribute('data-value')) extra.value = parseFloat(target.getAttribute('data-value')!);
    if (target.getAttribute('data-currency')) extra.currency = target.getAttribute('data-currency');
    if (target.getAttribute('data-order-id')) extra.orderId = target.getAttribute('data-order-id');

    track(eventName, extra);
  });

  /**
   * Автоматически подставлять start code в Telegram ссылки
   * <a data-tg-bot="mybot" href="#">Перейти в Telegram</a>
   * ИЛИ
   * <a href="https://t.me/mybot?start=PLACEHOLDER">...</a>
   */
  document.addEventListener('click', async function (e: MouseEvent) {
    const target = (e.target as HTMLElement).closest('[data-tg-bot], [href*="t.me"]') as HTMLElement | null;
    if (!target) return;

    const botUsername = target.getAttribute('data-tg-bot') ||
      target.getAttribute('href')?.match(/t\.me\/(\w+)/)?.[1];
    
    if (!botUsername) return;

    e.preventDefault();

    // Параллельно отправить Lead событие
    track('Lead', { channel: 'telegram' });

    // Получить start code
    const startCode = await generateTelegramStartCode();
    const tgUrl = startCode
      ? `https://t.me/${botUsername}?start=${startCode}`
      : `https://t.me/${botUsername}`;

    window.open(tgUrl, '_blank');
  });

  /**
   * Публичный API для ручного использования
   * window.tcrm.track('Purchase', { value: 99 })
   */
  (window as any).tcrm = {
    track,
    pageView: (data?: object) => track('PageView', data || {}),
    lead: (data?: object) => track('Lead', data || {}),
    purchase: (amount: number, currency = 'USD', data?: object) =>
      track('Purchase', { value: amount, currency, ...(data || {}) }),
  };

})(window, document);
```

---

## rollup.config.js — сборка browser bundle

```javascript
// apps/sdk/rollup.config.js
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

export default [
  // Минифицированный браузерный bundle
  {
    input: 'src/browser.ts',
    output: {
      file: 'dist/browser.min.js',
      format: 'iife',
    },
    plugins: [
      typescript({ tsconfig: './tsconfig.json' }),
      terser({
        compress: { drop_console: true }, // убрать console.* в продакшне
      }),
    ],
  },
  // Node.js CommonJS
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.js',
      format: 'cjs',
    },
    plugins: [typescript()],
  },
  // ESM
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.esm.js',
      format: 'esm',
    },
    plugins: [typescript()],
  },
];
```

---

## Hosting track.js на CDN (MinIO + Nginx)

После сборки `npm run build` в SDK:
```bash
# Скопировать в MinIO
mc cp apps/sdk/dist/browser.min.js minio/trafficcrm/sdk/track.js

# Nginx отдаёт с правильными заголовками
# cdn.trafficcrm.io/track.js
```

```nginx
location /sdk/ {
  proxy_pass http://minio:9000/trafficcrm/;
  add_header Cache-Control "public, max-age=3600";
  add_header Access-Control-Allow-Origin "*";
}
```

---

## REST API документация для клиентов

Эта документация показывается в дашборде в разделе "Интеграция".

### Базовый URL
```
https://api.trafficcrm.io/api/v1
```

### Аутентификация серверных запросов

Все серверные запросы подписываются HMAC-SHA256:

```
X-Signature: sha256=<подпись>
X-Timestamp: <unix timestamp в миллисекундах>
```

Формула подписи:
```
signature = HMAC-SHA256(secretKey, timestamp + "." + requestBody)
```

### Пример на разных языках

**Node.js:**
```javascript
const crypto = require('crypto');

const secretKey = 'sk_live_ваш_ключ';
const projectId = 'project_id';
const timestamp = Date.now().toString();

const body = JSON.stringify({
  eventName: 'Purchase',
  value: 99.00,
  currency: 'USD',
  orderId: 'order_123',
  email: 'user@example.com',
});

const signature = 'sha256=' + crypto
  .createHmac('sha256', secretKey)
  .update(`${timestamp}.${body}`)
  .digest('hex');

await fetch(`https://api.trafficcrm.io/api/v1/track/server/${projectId}/event`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Signature': signature,
    'X-Timestamp': timestamp,
  },
  body,
});
```

**Python:**
```python
import hmac, hashlib, json, time, requests

secret_key = 'sk_live_ваш_ключ'
project_id = 'project_id'
timestamp = str(int(time.time() * 1000))

body = json.dumps({
    'eventName': 'Purchase',
    'value': 99.00,
    'currency': 'USD',
    'orderId': 'order_123',
})

signature = 'sha256=' + hmac.new(
    secret_key.encode(),
    f'{timestamp}.{body}'.encode(),
    hashlib.sha256
).hexdigest()

response = requests.post(
    f'https://api.trafficcrm.io/api/v1/track/server/{project_id}/event',
    headers={
        'Content-Type': 'application/json',
        'X-Signature': signature,
        'X-Timestamp': timestamp,
    },
    data=body
)
```

**PHP:**
```php
$secretKey = 'sk_live_ваш_ключ';
$projectId = 'project_id';
$timestamp = (string)(round(microtime(true) * 1000));

$body = json_encode([
    'eventName' => 'Purchase',
    'value' => 99.00,
    'currency' => 'USD',
    'orderId' => 'order_123',
]);

$signature = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $body, $secretKey);

$ch = curl_init("https://api.trafficcrm.io/api/v1/track/server/{$projectId}/event");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        "X-Signature: {$signature}",
        "X-Timestamp: {$timestamp}",
    ],
]);
curl_exec($ch);
```

---

## Эндпоинт для генерации Telegram start code

```typescript
// В tracking.controller.ts добавить:

// POST /api/v1/track/:publicToken/tg-start
// Тело: { fbclid, ttclid, utmSource, ... }
// Ответ: { startCode: "abc123" }

@Public()
@Post(':publicToken/tg-start')
async generateTgStartCode(
  @Param('publicToken') publicToken: string,
  @Body() trackingData: Record<string, string>,
): Promise<{ startCode: string }> {
  const project = await this.projectsService.findByPublicToken(publicToken);
  if (!project) throw new NotFoundException();

  const startCode = nanoid(16);
  
  // Сохранить в Redis на 24 часа
  await this.redis.setex(
    `tg:start:${startCode}`,
    86400,
    JSON.stringify({
      projectId: project.id,
      ...trackingData,
    })
  );

  return { startCode };
}
```

---

## Страница интеграции в дашборде

```tsx
// apps/web/src/app/(dashboard)/projects/[id]/settings/page.tsx

// Секция "Внешняя интеграция":
// 1. Показать Public Token и Secret Key (с маскировкой)
// 2. Кнопки "Копировать" и "Перегенерировать токены"
// 3. Табы: JS Snippet | npm SDK | REST API
// 4. Поле "Разрешённые домены" (CORS whitelist)
// 5. Готовый код для копирования с подсвеченным синтаксисом

// Компонент CodeBlock с кнопкой "Копировать":
function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <div className="relative">
      <pre className="p-4 bg-zinc-950 text-zinc-100 rounded-lg text-sm overflow-x-auto">
        <code>{code}</code>
      </pre>
      <button
        onClick={copy}
        className="absolute top-3 right-3 p-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}
```

---

## Тестирование интеграции

Добавить в настройки проекта раздел "Тест событий":

```tsx
// Компонент TestEventSender
// Позволяет отправить тестовое событие и увидеть результат в реальном времени

function TestEventSender({ projectId }) {
  const [eventName, setEventName] = useState('PageView');
  const [result, setResult] = useState(null);
  
  const sendTest = async () => {
    const res = await api.post(`/tracking/test/${projectId}`, { eventName });
    setResult(res.data.data);
  };
  
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select value={eventName} onChange={e => setEventName(e.target.value)}>
          <option>PageView</option>
          <option>Lead</option>
          <option>Subscribe</option>
          <option>Purchase</option>
        </select>
        <Button onClick={sendTest}>Отправить тест</Button>
      </div>
      {result && (
        <div className="p-3 bg-muted rounded-lg text-sm font-mono">
          <div>Facebook: {result.fbStatus === 'sent' ? '✅' : '❌'} {result.fbStatus}</div>
          <div>TikTok: {result.ttStatus === 'sent' ? '✅' : '❌'} {result.ttStatus}</div>
          <div>Event ID: {result.eventId}</div>
        </div>
      )}
    </div>
  );
}
```
