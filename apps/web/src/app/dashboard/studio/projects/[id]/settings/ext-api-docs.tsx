'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from '@/components/ui/accordion';

// Подробная документация единого API событий (2026-11-05: «добавь максимально подробную
// документацию… покажи все типы и варианты запросов и примеры, сделай аккордеоном»). Всё описанное
// здесь сверено с ext-api.service.ts / ext-event.dto.ts — при изменении API править и этот файл.

const FG = 'text-[#131A24] dark:text-[#E9EDF3]';
const MUTED = 'text-[#5F6B7A] dark:text-[#92A0AF]';
const CODE = 'rounded-lg bg-[#0F1620] text-[#E9EDF3] text-xs p-3 overflow-x-auto whitespace-pre font-mono';
const INLINE = 'font-mono text-[0.85em] rounded bg-[#EEF1F5] dark:bg-white/10 px-1 py-0.5';
const ITEM = 'bg-white dark:bg-[#171F2B] ring-[#DCE1E8] dark:ring-white/10';
const BADGE = 'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide';
const REQ = `${BADGE} bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300`;
const OPT = `${BADGE} bg-[#EEF1F5] text-[#5F6B7A] dark:bg-white/10 dark:text-[#92A0AF]`;
const ADS = `${BADGE} bg-blue-50 text-[#1F4E9C] dark:bg-[#7BA9EE]/15 dark:text-[#7BA9EE]`;

function C({ children }: { children: React.ReactNode }) {
  return <code className={INLINE}>{children}</code>;
}

function CodeBlock({ code, title }: { code: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {title && <span className={`text-xs font-medium ${FG}`}>{title}</span>}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className={`inline-flex items-center gap-1 text-xs ${MUTED} hover:text-[#1F4E9C] dark:hover:text-[#7BA9EE]`}
        >
          <Copy className="w-3 h-3" /> {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre className={CODE}>{code}</pre>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr className={`text-left text-xs ${MUTED}`}>
            {head.map((h) => (
              <th key={h} className="py-1.5 px-1 font-medium align-bottom">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((cell, j) => (
                <td key={j} className={`py-1.5 px-1 ${j === 0 ? `font-mono whitespace-nowrap ${FG}` : MUTED}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ value, title, hint, children }: { value: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <AccordionItem value={value} className={ITEM}>
      <AccordionTrigger className={FG}>
        <span className="flex-1 min-w-0">
          <span className="block">{title}</span>
          {hint && <span className={`block text-xs font-normal ${MUTED}`}>{hint}</span>}
        </span>
      </AccordionTrigger>
      <AccordionPanel>
        <div className={`space-y-3 ${MUTED}`}>{children}</div>
      </AccordionPanel>
    </AccordionItem>
  );
}

// ---- Поля ----

const R = <span className={REQ}>обяз.</span>;
const O = <span className={OPT}>необяз.</span>;

const IDENTITY_FIELDS: React.ReactNode[][] = [
  ['tg_user_id', 'число или строка из цифр', <>Telegram ID лида. Главный идентификатор: обязателен для <C>start</C>, <C>bot_blocked</C>, <C>bot_unblocked</C>, нужен, чтобы сообщения попадали в чат CRM.</>],
  ['external_id', 'строка, до 200', 'ID лида в вашей системе (CRM, бот-платформа, сайт). Для лидов без Telegram.'],
  ['phone', 'строка, до 40', 'Телефон в любом формате, лучше международный: +50688880000. Нужно хотя бы 6 цифр. Улучшает сопоставление в FB и TikTok.'],
  ['email', 'строка, до 200', 'Email, приводится к нижнему регистру. Улучшает сопоставление в FB и TikTok.'],
  ['username', 'строка, до 64', 'Username в Telegram, с @ или без.'],
  ['first_name', 'строка, до 128', 'Имя.'],
  ['last_name', 'строка, до 128', 'Фамилия.'],
  ['language', 'строка, до 10', 'Язык лида (es, ru, en…). Сохраняется только при создании лида.'],
];

const EVENT_FIELDS: React.ReactNode[][] = [
  ['type', <>строка {R}</>, 'Тип события, см. раздел «Типы событий».'],
  ['event_id', <>строка, до 200 {O}</>, <>Ваш уникальный ID события. Повтор с тем же <C>event_id</C> не обработается второй раз — ответ вернётся с <C>duplicate: true</C>. Очень рекомендуем передавать всегда.</>],
  ['occurred_at', <>ISO 8601 {O}</>, <>Когда произошло событие, например <C>2026-11-05T14:30:00Z</C>. Сейчас используется как время сообщения в чате для <C>message_in</C>; остальные события фиксируются временем приёма.</>],
  ['start_code', <>строка, до 200 {O}</>, <>Код из команды /start (то, что после <C>?start=</C> в ссылке). Можно передать и целиком <C>/start Kx7f2aB9</C>. По нему подтягивается вся рекламная атрибуция визита на лендинг.</>],
  ['attribution', <>объект {O}</>, 'Рекламные метки напрямую — если лид пришёл не через наш лендинг или код недоступен. Поля — в разделе «Данные для Facebook и TikTok».'],
  ['text', <>строка, до 4096 {O}</>, <>Текст сообщения: для <C>message_in</C> (желательно) и <C>message_out</C> (обязательно).</>],
  ['amount', <>число &gt; 0 {O}</>, <>Сумма покупки. Обязательна для <C>purchase</C>. Дробная — через точку: <C>49.90</C>.</>],
  ['currency', <>строка, 3 буквы {O}</>, <>Валюта ISO 4217: USD, EUR, CRC… По умолчанию USD.</>],
  ['purchase_id', <>строка, до 200 {O}</>, <>ID заказа/депозита в вашей системе. Защищает от задвоения покупки (если не передан — используется <C>event_id</C>).</>],
];

const ATTRIBUTION_FIELDS: React.ReactNode[][] = [
  ['fbclid', 'Facebook', <>Параметр <C>fbclid</C> из ссылки клика. Отправляется в FB как <C>fbc</C> — самый сильный сигнал сопоставления.</>],
  ['fbp', 'Facebook', <>Значение cookie <C>_fbp</C> с сайта (вида <C>fb.1.1730800000000.123456789</C>). В FB — <C>fbp</C>.</>],
  ['ttclid', 'TikTok', <>Параметр <C>ttclid</C> из ссылки клика. В TikTok — <C>ad.callback</C>.</>],
  ['ip', 'FB + TikTok', <>IP лида в момент клика/визита (IPv4 или IPv6). В FB — <C>client_ip_address</C>, в TikTok — <C>context.ip</C>.</>],
  ['user_agent', 'FB + TikTok', <>User-Agent браузера лида. В FB — <C>client_user_agent</C>, в TikTok — <C>context.user_agent</C>. Передавайте вместе с ip.</>],
  ['country_code', 'Facebook', <>Страна, 2 буквы ISO: CR, GT, MX. В FB — <C>country</C> (хэшируется нами).</>],
  ['pixel', 'маршрут', <>ID пикселя из CRM или его короткий код (параметр <C>pixel=</C> из ссылки). События уйдут только в этот пиксель; без него — во все активные пиксели проекта.</>],
  ['buyer', 'CRM', <>ID баера или его короткий код (параметр <C>z=</C> из ссылки). Для статистики по баерам.</>],
  ['campaign_id, campaign_name', 'CRM', 'Кампания — для разбивки по рекламе и «Топа кампаний».'],
  ['adset_id, adset_name', 'CRM', 'Группа объявлений.'],
  ['ad_id, ad_name', 'CRM', 'Объявление.'],
  ['placement', 'CRM', 'Плейсмент (Facebook_Mobile_Feed, Instagram_Stories…).'],
  ['site_source_name', 'CRM', 'Источник показа (fb, ig, an, msg).'],
  ['utm_source, utm_medium, utm_campaign, utm_content, utm_term', 'CRM', 'UTM-метки — в карточку лида и экспорт.'],
];

// ---- События ----

interface EventDoc {
  type: string;
  title: string;
  when: string;
  required: React.ReactNode;
  effects: React.ReactNode[];
  ads?: string;
  example: Record<string, unknown>;
  response: Record<string, unknown>;
  extra?: { title: string; example: Record<string, unknown> }[];
}

const EVENTS: EventDoc[] = [
  {
    type: 'start',
    title: 'Лид нажал «Старт» у бота',
    when: 'Сразу, как ваш бот получил команду /start.',
    required: <><C>tg_user_id</C>. Желательно <C>start_code</C> и данные профиля.</>,
    effects: [
      'Создаёт лида или находит существующего, обновляет имя и username.',
      <>Если <C>start_code</C> найден (визит на лендинг за последние 24 часа или ссылка на бота) — к лиду привязывается вся реклама: пиксель, баер, кампания, объявление, fbclid, fbp, IP, User-Agent, страна, лендинг, A/B-тест.</>,
      <>Лид засчитывается, если пришёл по коду или если в «Воронке» проекта лидом считается любой старт бота. Без кода и без этой настройки — лид создаётся, но не считается лидом воронки.</>,
      'Код одноразовый: после использования удаляется. Повторный /start того же лида не задваивает лида и Subscribe.',
      'Если у проекта Telegram-бот — в чате CRM появится «/start».',
    ],
    ads: 'Subscribe (один раз на лида)',
    example: { type: 'start', event_id: 'start-123456789-1730816400', tg_user_id: 123456789, username: 'ana_maria', first_name: 'Ana', last_name: 'Rojas', language: 'es', start_code: 'Kx7f2aB9' },
    response: { ok: true, type: 'start', event_id: 'start-123456789-1730816400', client_id: 'cmh1x…', attributed: true, lead: true },
    extra: [
      {
        title: 'Старт без нашего лендинга — метки передаём сами',
        example: { type: 'start', event_id: 'start-555-1', tg_user_id: 555000111, first_name: 'Luis', attribution: { fbclid: 'IwAR2x…', fbp: 'fb.1.1730816000000.987654321', ip: '201.200.10.5', user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)…', country_code: 'CR', pixel: 'a1B2c3', buyer: 'Zx9Yw8', campaign_id: '120210000000001', campaign_name: 'CR_Spring', ad_id: '120210000000003', ad_name: 'video_1' } },
      },
    ],
  },
  {
    type: 'lead',
    title: 'Новый лид из любой воронки',
    when: 'Лид оставил заявку: форма на сайте, другой канал, внешняя CRM. Telegram не обязателен.',
    required: <>Любой идентификатор: <C>tg_user_id</C>, <C>external_id</C>, <C>phone</C> или <C>email</C>.</>,
    effects: [
      'Создаёт лида (или находит существующего) и отмечает его подписчиком воронки.',
      <>Атрибуция — из <C>start_code</C> или <C>attribution</C>. У существующего лида уже записанная атрибуция не перезаписывается — побеждает первая.</>,
      'Лид засчитывается в статистике один раз — повторный lead по тому же человеку не задваивается.',
    ],
    ads: 'Subscribe (один раз на лида), с хэшированными phone/email',
    example: { type: 'lead', event_id: 'form-5521', external_id: 'crm-5521', first_name: 'Ana', phone: '+50688880000', email: 'ana@mail.com', attribution: { fbclid: 'IwAR2x…', fbp: 'fb.1.1730816000000.987654321', ip: '201.200.10.5', user_agent: 'Mozilla/5.0 …', country_code: 'CR', pixel: 'a1B2c3', buyer: 'Zx9Yw8', utm_source: 'facebook', utm_campaign: 'spring' } },
    response: { ok: true, type: 'lead', event_id: 'form-5521', client_id: 'cmh1y…', attributed: true, lead: true },
  },
  {
    type: 'subscribe',
    title: 'Подписался на канал',
    when: 'Лид вступил в ваш канал/группу. Работает точно так же, как lead.',
    required: <>Любой идентификатор, обычно <C>tg_user_id</C>.</>,
    effects: ['То же, что lead: лид отмечается подписчиком, засчитывается один раз.'],
    ads: 'Subscribe (один раз на лида)',
    example: { type: 'subscribe', event_id: 'sub-123456789', tg_user_id: 123456789, start_code: 'Kx7f2aB9' },
    response: { ok: true, type: 'subscribe', event_id: 'sub-123456789', client_id: 'cmh1x…', attributed: true, lead: false },
  },
  {
    type: 'unsubscribe',
    title: 'Отписался',
    when: 'Лид вышел из канала или отписался в вашей системе.',
    required: <>Идентификатор уже известного лида.</>,
    effects: ['Лид помечается отписавшимся (дата отписки — в карточке и статистике).', 'Событие отписки уходит только для настоящих подписчиков воронки (у кого был лид/Subscribe).', <>Если лида нет в CRM — ошибка <C>Лид не найден</C>.</>],
    ads: 'Unsubscribe (пользовательское событие)',
    example: { type: 'unsubscribe', event_id: 'unsub-123456789-1', tg_user_id: 123456789 },
    response: { ok: true, type: 'unsubscribe', event_id: 'unsub-123456789-1', client_id: 'cmh1x…' },
  },
  {
    type: 'message_in',
    title: 'Сообщение от лида',
    when: 'Каждое входящее сообщение лида вашему боту/оператору.',
    required: <>Идентификатор. Для чата CRM — <C>tg_user_id</C> и <C>text</C>.</>,
    effects: [
      'Первое сообщение лида засчитывается как «Диалог» (один раз).',
      'Если лида ещё нет — он создаётся, но лидом воронки не считается (для этого нужен start/lead).',
      <>Текст попадает в чат CRM (вкладка «Чаты»), если передан <C>tg_user_id</C> и у проекта Telegram-бот. Время — из <C>occurred_at</C>.</>,
    ],
    ads: 'Диалог: в FB — Contact, в TikTok — Contact (один раз на лида)',
    example: { type: 'message_in', event_id: 'msg-98123', tg_user_id: 123456789, text: 'Hola, ¿cómo empiezo?', occurred_at: '2026-11-05T14:30:00Z' },
    response: { ok: true, type: 'message_in', event_id: 'msg-98123', client_id: 'cmh1x…' },
    extra: [{ title: 'Диалог лида без Telegram (например, WhatsApp)', example: { type: 'message_in', event_id: 'wa-771', external_id: 'crm-5521', phone: '+50688880000', text: 'Hola' } }],
  },
  {
    type: 'message_out',
    title: 'Ответ бота или оператора',
    when: 'Ваш бот/оператор отправил сообщение лиду — чтобы переписка в CRM была полной.',
    required: <><C>tg_user_id</C> и <C>text</C>.</>,
    effects: ['Только добавляет сообщение в чат CRM, на статистику не влияет.', 'Сохраняется, если переписка с лидом уже есть (был start или message_in).'],
    example: { type: 'message_out', event_id: 'out-98124', tg_user_id: 123456789, text: '¡Hola Ana! Te explico…' },
    response: { ok: true, type: 'message_out', event_id: 'out-98124', client_id: 'cmh1x…' },
  },
  {
    type: 'bot_blocked',
    title: 'Лид заблокировал бота',
    when: 'Ваш бот получил ошибку «bot was blocked by the user» или событие блокировки.',
    required: <><C>tg_user_id</C> уже известного лида.</>,
    effects: ['Лид помечается недоступным для рассылок, в статистике — блокировка бота.'],
    example: { type: 'bot_blocked', event_id: 'blk-123456789-1', tg_user_id: 123456789 },
    response: { ok: true, type: 'bot_blocked', event_id: 'blk-123456789-1', client_id: 'cmh1x…' },
  },
  {
    type: 'bot_unblocked',
    title: 'Лид разблокировал бота',
    when: 'Лид снова запустил бота после блокировки.',
    required: <><C>tg_user_id</C> уже известного лида.</>,
    effects: ['Лид снова считается доступным.'],
    example: { type: 'bot_unblocked', event_id: 'unblk-123456789-1', tg_user_id: 123456789 },
    response: { ok: true, type: 'bot_unblocked', event_id: 'unblk-123456789-1', client_id: 'cmh1x…' },
  },
  {
    type: 'contact',
    title: 'Обновить данные лида',
    when: 'Лид поделился телефоном/email или поменялись имя и username.',
    required: 'Идентификатор плюс поля для обновления.',
    effects: [
      'Обновляет телефон, email, имя, username; external_id — если ещё не был задан.',
      'Если лида нет — создаёт его, но не считает лидом воронки. Событий в статистику и рекламу нет.',
      <>Можно дослать <C>attribution</C> — запишется, если у лида её ещё не было.</>,
    ],
    example: { type: 'contact', event_id: 'contact-123456789', tg_user_id: 123456789, phone: '+50688880000', email: 'ana@mail.com' },
    response: { ok: true, type: 'contact', event_id: 'contact-123456789', client_id: 'cmh1x…' },
  },
  {
    type: 'purchase',
    title: 'Покупка / депозит',
    when: 'Лид оплатил или внёс депозит.',
    required: <>Идентификатор и <C>amount</C>. Желательно <C>currency</C> и <C>purchase_id</C>.</>,
    effects: [
      'Первый депозит лида считается ФД, следующие — РД, автоматически.',
      <>Повтор с тем же <C>purchase_id</C> (или <C>event_id</C>) не задвоит покупку.</>,
      'Если лида ещё не было — он создаётся и сразу засчитывается лидом (Subscribe тоже уйдёт).',
      'Покупка видна в карточке лида, в выручке проекта, у баера и в «Топах».',
    ],
    ads: 'Purchase с суммой и валютой (в TikTok — CompletePayment)',
    example: { type: 'purchase', event_id: 'pay-981', tg_user_id: 123456789, amount: 50, currency: 'USD', purchase_id: 'order-981' },
    response: { ok: true, type: 'purchase', event_id: 'pay-981', client_id: 'cmh1x…', purchase_id: 'cmh2a…' },
    extra: [{ title: 'Покупка лида без Telegram', example: { type: 'purchase', event_id: 'pay-982', external_id: 'crm-5521', email: 'ana@mail.com', amount: 125.5, currency: 'EUR', purchase_id: 'order-982' } }],
  },
];

const json = (v: unknown) => JSON.stringify(v, null, 2);

export function ExtApiDocs({ base, apiKey }: { base: string; apiKey: string }) {
  const [lang, setLang] = useState<'curl' | 'node' | 'python' | 'php'>('curl');
  const url = `${base}/ext/event`;
  const sample = { type: 'start', event_id: 'start-123456789-1730816400', tg_user_id: 123456789, first_name: 'Ana', start_code: 'Kx7f2aB9' };

  const curlFor = (path: string, body: unknown) =>
    `curl -X POST ${base}${path} \\\n  -H "X-Api-Key: ${apiKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body, null, 2).replace(/'/g, "'\\''")}'`;

  const SNIPPETS = {
    curl: curlFor('/ext/event', sample),
    node: `// Node.js 18+ (встроенный fetch)
const API = '${base}';
const KEY = process.env.MWTRACK_API_KEY; // ${apiKey}

async function sendEvent(event) {
  const res = await fetch(\`\${API}/ext/event\`, {
    method: 'POST',
    headers: { 'X-Api-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  const data = await res.json();
  if (res.status === 400 || res.status === 401) {
    // Ошибка запроса — повтор не поможет, исправьте данные/ключ
    throw new Error(data.error?.message + ' ' + (data.error?.details ?? []).join('; '));
  }
  if (!res.ok) throw new Error('HTTP ' + res.status); // 5xx — можно повторить с тем же event_id
  if (!data.ok) console.warn('Событие не обработано:', data.error);
  return data;
}

// Пример: бот получил /start Kx7f2aB9
await sendEvent({
  type: 'start',
  event_id: \`start-\${ctx.from.id}-\${ctx.message.date}\`,
  tg_user_id: ctx.from.id,
  username: ctx.from.username,
  first_name: ctx.from.first_name,
  last_name: ctx.from.last_name,
  language: ctx.from.language_code,
  start_code: ctx.message.text, // "/start Kx7f2aB9" — можно целиком
});`,
    python: `# Python 3, pip install requests
import os, requests

API = "${base}"
KEY = os.environ["MWTRACK_API_KEY"]  # ${apiKey}

def send_event(event: dict) -> dict:
    r = requests.post(f"{API}/ext/event", json=event,
                      headers={"X-Api-Key": KEY}, timeout=15)
    if r.status_code in (400, 401):
        # Ошибка запроса — повтор не поможет
        raise ValueError(r.json()["error"])
    r.raise_for_status()  # 5xx — можно повторить с тем же event_id
    data = r.json()
    if not data["ok"]:
        print("Событие не обработано:", data.get("error"))
    return data

send_event({
    "type": "purchase",
    "event_id": "pay-981",
    "tg_user_id": 123456789,
    "amount": 50,
    "currency": "USD",
    "purchase_id": "order-981",
})`,
    php: `<?php
// PHP 7.4+ с curl
function mwtrack_event(array $event): array {
    $ch = curl_init('${url}');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'X-Api-Key: ' . getenv('MWTRACK_API_KEY'), // ${apiKey}
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($event, JSON_UNESCAPED_UNICODE),
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = json_decode($body, true);
    if ($code >= 400) throw new Exception($data['error']['message'] ?? "HTTP $code");
    return $data;
}

mwtrack_event([
    'type' => 'lead',
    'event_id' => 'form-5521',
    'external_id' => 'crm-5521',
    'phone' => '+50688880000',
    'email' => 'ana@mail.com',
    'attribution' => ['fbclid' => $_GET['fbclid'] ?? null, 'fbp' => $_COOKIE['_fbp'] ?? null,
                      'ip' => $_SERVER['REMOTE_ADDR'], 'user_agent' => $_SERVER['HTTP_USER_AGENT']],
]);`,
  };

  const fullLead = {
    type: 'lead',
    event_id: 'form-5521',
    occurred_at: '2026-11-05T14:30:00Z',
    external_id: 'crm-5521',
    tg_user_id: 123456789,
    username: 'ana_maria',
    first_name: 'Ana',
    last_name: 'Rojas',
    language: 'es',
    phone: '+50688880000',
    email: 'ana@mail.com',
    attribution: {
      fbclid: 'IwAR2xYz…',
      fbp: 'fb.1.1730816000000.987654321',
      ttclid: null,
      ip: '201.200.10.5',
      user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 …',
      country_code: 'CR',
      pixel: 'a1B2c3',
      buyer: 'Zx9Yw8',
      campaign_id: '120210000000001',
      campaign_name: 'CR_Spring',
      adset_id: '120210000000002',
      adset_name: 'CR_25-45',
      ad_id: '120210000000003',
      ad_name: 'video_1',
      placement: 'Facebook_Mobile_Feed',
      site_source_name: 'fb',
      utm_source: 'facebook',
      utm_medium: 'cpc',
      utm_campaign: 'spring',
      utm_content: 'video_1',
      utm_term: 'casino',
    },
  };

  return (
    <Accordion multiple className="space-y-2">
      <Section value="quick" title="Быстрый старт" hint="Три шага до первого события">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>
            Скопируйте ключ проекта выше и проверьте его: <C>GET {base}/ext/ping</C> с заголовком <C>X-Api-Key</C>. Ответ{' '}
            <C>{'{"ok":true,"project":{…}}'}</C> — ключ рабочий.
          </li>
          <li>
            Когда ваш бот получает <C>/start КОД</C>, отправьте событие <C>start</C> с <C>tg_user_id</C> и <C>start_code</C> — лид привяжется к
            рекламе и засчитается.
          </li>
          <li>
            Дальше шлите <C>message_in</C> на сообщения лида и <C>purchase</C> на оплаты. Результат каждого запроса виден ниже в «Последних
            запросах», лиды — в «Клиентах» проекта.
          </li>
        </ol>
        <CodeBlock title="Проверка ключа" code={`curl ${base}/ext/ping -H "X-Api-Key: ${apiKey}"`} />
      </Section>

      <Section value="auth" title="Адреса и авторизация" hint="Эндпоинты, заголовки, формат">
        <Table
          head={['Метод и адрес', 'Что делает']}
          rows={[
            [`GET ${base}/ext/ping`, 'Проверка ключа. Возвращает проект, к которому он относится.'],
            [`POST ${base}/ext/event`, 'Одно событие. Тело — объект события.'],
            [`POST ${base}/ext/events`, <>Пачка до 100 событий: <C>{'{"events":[…]}'}</C>. Обрабатываются по порядку, результат — на каждое.</>],
          ]}
        />
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Ключ — в заголовке <C>X-Api-Key: sk_…</C> или <C>Authorization: Bearer sk_…</C>. Это секретный ключ проекта: храните его только на
            сервере, не вставляйте в код сайта или бота на стороне пользователя.
          </li>
          <li>
            Ключ определяет проект: все события попадут в тот проект, чей ключ. Перевыпустить ключ можно во вкладке «Интеграция» — старый сразу
            перестанет работать.
          </li>
          <li>
            Тело — JSON, заголовок <C>Content-Type: application/json</C>, кодировка UTF-8. Имена полей — snake_case, как в примерах.
          </li>
          <li>
            Подходит для любого проекта: бот на внешней платформе, подключённый бот, канал, сайт, своя воронка.
          </li>
        </ul>
      </Section>

      <Section value="identity" title="Как определяется лид" hint="tg_user_id, external_id, phone, email">
        <p>
          В каждом событии должен быть хотя бы один идентификатор. Поиск лида внутри проекта идёт по <b>первому переданному</b> из списка:
        </p>
        <ol className="list-decimal pl-5 space-y-1">
          <li><C>tg_user_id</C> — если передан, ищем только по нему;</li>
          <li><C>external_id</C>;</li>
          <li><C>phone</C>, а если по телефону не нашли — <C>email</C>.</li>
        </ol>
        <p>
          Не найден — лид создаётся (для событий, которые создают лида). Остальные переданные поля (телефон, email, имя, username, external_id)
          записываются в карточку и при следующих событиях обновляются.
        </p>
        <p>
          <b className={FG}>Совет:</b> во всех событиях одного человека передавайте один и тот же главный идентификатор. Если лид пришёл из Telegram
          — всегда <C>tg_user_id</C>; если из вашей CRM — всегда <C>external_id</C>. Иначе можно получить две карточки на одного человека.
        </p>
        <Table head={['Поле', 'Формат', 'Описание']} rows={IDENTITY_FIELDS} />
      </Section>

      <Section value="attribution" title="Привязка к рекламе" hint="start_code или attribution — без участия лида">
        <p>
          <b className={FG}>Способ 1 — код визита (рекомендуем для Telegram-ботов).</b> Кнопка нашего лендинга ведёт на бота ссылкой{' '}
          <C>t.me/ваш_бот?start=КОД</C>. Лид ничего не вводит: Telegram сам передаёт код боту при нажатии «Старт» — бот получает сообщение{' '}
          <C>/start КОД</C>. Передайте его в <C>start_code</C> события <C>start</C> (или <C>lead</C>/<C>subscribe</C>).
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Код живёт 24 часа с момента визита на лендинг и одноразовый.</li>
          <li>
            Подтягивается всё, что лендинг знал о визите: пиксель, баер, кампания/группа/объявление, плейсмент, fbclid/ttclid, fbp, IP,
            User-Agent, страна, лендинг, A/B-тест.
          </li>
          <li>
            Коды из «Ссылок на бота» (начинаются с <C>go_</C>) тоже работают — подтянутся источник, пиксель и баер ссылки, а также ID объявления и кампании, если они есть в коде.
          </li>
          <li>
            Код не найден (просрочен, чужой, лид пришёл без лендинга) — не ошибка: событие обработается, в ответе будет <C>attributed: false</C>.
          </li>
        </ul>
        <p>
          <b className={FG}>Способ 2 — метки напрямую</b> в объекте <C>attribution</C>: если лид пришёл с вашего сайта, формы или другой
          воронки. Чем больше полей передадите, тем лучше Facebook и TikTok сопоставят событие с кликом по рекламе — см. следующий раздел.
        </p>
        <p>
          Если переданы оба — при найденном коде используется код, иначе <C>attribution</C>. Атрибуция пишется один раз: у лида, у которого она
          уже есть, первая не перезаписывается.
        </p>
      </Section>

      <Section value="ads" title="Данные для Facebook и TikTok" hint="Необязательные поля, которые повышают качество сопоставления">
        <p>
          Все эти поля необязательны — событие примется и без них. Но именно по ним Facebook и TikTok понимают, какой клик по рекламе привёл к
          лиду и покупке: от них зависит качество сопоставления (Event Match Quality) и оптимизация кампаний.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b className={FG}>Минимум:</b> <C>fbclid</C> (или <C>ttclid</C> для TikTok) + <C>ip</C> + <C>user_agent</C>.
          </li>
          <li>
            <b className={FG}>Лучше:</b> плюс <C>fbp</C>, <C>country_code</C>, <C>pixel</C>, а на верхнем уровне события — <C>phone</C> и{' '}
            <C>email</C>.
          </li>
          <li>
            Телефон и email передавайте <b>как есть, открытым текстом</b> — мы сами приводим их к нужному виду и хэшируем SHA-256 перед
            отправкой. Уже захэшированные значения не присылайте.
          </li>
          <li>
            <C>ip</C>, <C>user_agent</C>, <C>fbp</C>, <C>fbclid</C> — из момента клика/визита на сайт, а не с вашего сервера. Если лид пришёл
            через наш лендинг и вы передаёте <C>start_code</C> — всё это уже есть, дублировать не нужно.
          </li>
        </ul>
        <Table head={['Поле attribution', 'Куда', 'Описание']} rows={ATTRIBUTION_FIELDS} />
        <p>
          <b className={FG}>Когда событие уходит в рекламу.</b> Только если у лида есть рекламная атрибуция: пиксель, fbclid, ttclid или ad_id.
          Лиды без неё считаются в CRM, но в кабинеты не отправляются — чтобы не приписывать рекламе чужие конверсии. Отправку Subscribe,
          отписки и «Диалога» можно выключить во вкладке «События»; покупки отправляются всегда.
        </p>
        <Table
          head={['Событие API', 'В CRM', 'Facebook', 'TikTok']}
          rows={[
            ['start / lead / subscribe', 'Лид (Subscribe)', 'Subscribe', 'Subscribe'],
            ['message_in (первое)', 'Диалог', 'Contact', 'Contact'],
            ['unsubscribe', 'Отписка', 'Unsubscribe', 'Unsubscribe'],
            ['purchase', 'Покупка ФД/РД', 'Purchase', 'CompletePayment'],
          ]}
        />
        <CodeBlock title="Пример: лид со всеми полями для рекламы" code={json(fullLead)} />
      </Section>

      <Section value="fields" title="Все поля события" hint="Полный справочник">
        <Table head={['Поле', 'Тип', 'Описание']} rows={EVENT_FIELDS} />
        <p className={`text-xs font-medium ${FG}`}>Идентификаторы и профиль</p>
        <Table head={['Поле', 'Формат', 'Описание']} rows={IDENTITY_FIELDS} />
        <p className={`text-xs font-medium ${FG}`}>Объект attribution</p>
        <Table head={['Поле', 'Куда', 'Описание']} rows={ATTRIBUTION_FIELDS} />
        <p>
          Поля, которых нет в этом списке, отклоняются ошибкой 400 — так опечатка в имени поля не потеряется молча. Пустые значения ({' '}
          <C>null</C>) можно не передавать.
        </p>
      </Section>

      <Section value="events" title="Типы событий" hint="10 типов — что делает каждый, примеры запросов и ответов">
        <Accordion multiple className="space-y-2">
          {EVENTS.map((e) => (
            <AccordionItem key={e.type} value={e.type} className={ITEM}>
              <AccordionTrigger className={FG}>
                <span className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <code className="font-mono font-semibold">{e.type}</code>
                  <span className={`font-normal ${MUTED}`}>{e.title}</span>
                  {e.ads && <span className={ADS}>в рекламу</span>}
                </span>
              </AccordionTrigger>
              <AccordionPanel>
                <div className={`space-y-3 ${MUTED}`}>
                  <p>
                    <b className={FG}>Когда:</b> {e.when}
                  </p>
                  <p>
                    <b className={FG}>Нужно:</b> {e.required}
                  </p>
                  <div>
                    <b className={FG}>Что происходит:</b>
                    <ul className="list-disc pl-5 mt-1 space-y-1">
                      {e.effects.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                  {e.ads && (
                    <p>
                      <b className={FG}>В Facebook / TikTok:</b> {e.ads}.
                    </p>
                  )}
                  <CodeBlock title="Запрос" code={curlFor('/ext/event', e.example)} />
                  {e.extra?.map((x) => <CodeBlock key={x.title} title={x.title} code={json(x.example)} />)}
                  <CodeBlock title="Ответ 200" code={json(e.response)} />
                </div>
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      </Section>

      <Section value="batch" title="Пачка событий" hint="До 100 событий за запрос">
        <p>
          <C>POST {base}/ext/events</C> с телом <C>{'{"events":[…]}'}</C>. События обрабатываются строго по порядку — сначала <C>start</C>, потом{' '}
          <C>message_in</C>, потом <C>purchase</C>. Ошибка в одном событии не мешает остальным; ответ — массив <C>results</C> в том же порядке.
        </p>
        <p>
          Важно: если в пачке есть событие с неверной схемой (неизвестный type, лишнее поле, неверный тип значения), вся пачка отклоняется
          ошибкой 400 и ничего не записывается.
        </p>
        <CodeBlock
          title="Запрос"
          code={curlFor('/ext/events', {
            events: [
              { type: 'start', event_id: 'start-123456789-1', tg_user_id: 123456789, first_name: 'Ana', start_code: 'Kx7f2aB9' },
              { type: 'message_in', event_id: 'msg-1', tg_user_id: 123456789, text: 'Hola' },
              { type: 'message_out', event_id: 'out-1', tg_user_id: 123456789, text: '¡Hola Ana!' },
              { type: 'purchase', event_id: 'pay-1', tg_user_id: 123456789, amount: 50, currency: 'USD', purchase_id: 'order-981' },
            ],
          })}
        />
        <CodeBlock
          title="Ответ 200"
          code={json({
            results: [
              { ok: true, type: 'start', event_id: 'start-123456789-1', client_id: 'cmh1x…', attributed: true, lead: true },
              { ok: true, type: 'message_in', event_id: 'msg-1', client_id: 'cmh1x…' },
              { ok: true, type: 'message_out', event_id: 'out-1', client_id: 'cmh1x…' },
              { ok: true, type: 'purchase', event_id: 'pay-1', client_id: 'cmh1x…', purchase_id: 'cmh2a…' },
            ],
          })}
        />
      </Section>

      <Section value="responses" title="Ответы и ошибки" hint="Коды HTTP, поля ответа, что повторять">
        <Table
          head={['Код', 'Когда', 'Что делать']}
          rows={[
            ['200, ok: true', 'Событие принято и обработано.', '—'],
            ['200, ok: false', <>Запрос корректный, но событие не обработано (например, лид не найден). Причина — в <C>error</C>.</>, 'Исправить данные. Повтор с тем же event_id вернёт ту же ошибку — для новой попытки нужен новый event_id.'],
            ['200, duplicate: true', 'Событие с таким event_id уже было. Возвращается прошлый результат.', 'Ничего, это нормально при повторной отправке.'],
            ['400 VALIDATION_ERROR', <>Неверная схема: неизвестный type, лишнее поле, неверный формат. Список — в <C>error.details</C>.</>, 'Исправить запрос, повтор без изменений не поможет.'],
            ['401 UNAUTHORIZED', 'Нет ключа, неверный ключ или компания заблокирована.', 'Проверить ключ в «Интеграции».'],
            ['5xx / таймаут', 'Временная ошибка сервера или сети.', 'Повторить через 5–30 секунд с тем же event_id — задвоения не будет.'],
          ]}
        />
        <p className={`text-xs font-medium ${FG}`}>Поля ответа на событие</p>
        <Table
          head={['Поле', 'Описание']}
          rows={[
            ['ok', 'Обработано ли событие.'],
            ['type, event_id', 'Повторяют запрос.'],
            ['client_id', 'ID лида в CRM.'],
            ['attributed', <>Для start/lead/subscribe: удалось ли привязать рекламу (по <C>start_code</C> или <C>attribution</C>).</>],
            ['lead', 'Для start/lead/subscribe: засчитан ли лид именно этим событием (false — уже был лидом или не считается лидом).'],
            ['purchase_id', 'Для purchase: ID покупки в CRM.'],
            ['duplicate', 'true — событие с этим event_id уже обрабатывалось.'],
            ['error', 'Причина, если ok: false.'],
          ]}
        />
        <CodeBlock title="Пример 400" code={json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Ошибка валидации', details: ['property foo should not exist'] } })} />
        <CodeBlock title="Пример ok: false" code={json({ ok: false, type: 'purchase', event_id: 'pay-7', error: 'Для purchase нужна сумма amount' })} />
        <p className={`text-xs font-medium ${FG}`}>Частые ошибки в error</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><C>Укажите, кто это: tg_user_id, external_id, phone или email</C> — нет ни одного идентификатора.</li>
          <li><C>tg_user_id — число (Telegram ID)</C> — передан не числовой ID.</li>
          <li><C>Для start нужен tg_user_id</C>, <C>Для message_out нужен text</C>, <C>Для purchase нужна сумма amount</C>.</li>
          <li><C>Лид не найден</C> / <C>Лид с таким tg_user_id не найден</C> — unsubscribe или блокировка по лиду, которого в CRM нет.</li>
          <li><C>Клиент не создан — возможно, достигнут лимит клиентов тарифа</C>.</li>
        </ul>
      </Section>

      <Section value="idempotency" title="Повторы и порядок событий" hint="event_id, purchase_id, ретраи">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <C>event_id</C> — уникален в пределах проекта. Хороший формат: <C>тип-кто-когда</C>, например <C>start-123456789-1730816400</C> или ID
            сообщения/платежа из вашей системы.
          </li>
          <li>Повтор с тем же event_id ничего не меняет и возвращает прошлый результат — поэтому при таймауте смело повторяйте.</li>
          <li>
            Покупки дополнительно защищены <C>purchase_id</C>: даже с разными event_id одна и та же покупка не задвоится.
          </li>
          <li>
            Без event_id каждое событие обрабатывается заново. Лид, Subscribe и Диалог всё равно не задвоятся (считаются один раз на лида), а
            сообщения в чате и покупки без purchase_id — задвоятся.
          </li>
          <li>
            Отправляйте события в том порядке, в каком они произошли: сначала <C>start</C> с кодом, потом остальное — иначе первое событие
            создаст лида без рекламы, а атрибуция допишется позже (это тоже работает, но лид засчитается позже).
          </li>
          <li>Отправляйте события сразу, как они произошли: код визита живёт 24 часа.</li>
        </ul>
      </Section>

      <Section value="code" title="Примеры кода" hint="cURL, Node.js, Python, PHP">
        <div className="inline-flex rounded-lg bg-[#EEF1F5] dark:bg-white/10 p-1 gap-0.5">
          {(
            [
              ['curl', 'cURL'],
              ['node', 'Node.js'],
              ['python', 'Python'],
              ['php', 'PHP'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setLang(id)}
              className={
                lang === id
                  ? `px-3 py-1 rounded-md text-xs font-medium bg-white dark:bg-[#0F1620] shadow-sm ${FG}`
                  : `px-3 py-1 rounded-md text-xs ${MUTED}`
              }
            >
              {label}
            </button>
          ))}
        </div>
        <CodeBlock code={SNIPPETS[lang]} />
      </Section>

      <Section value="log" title="Журнал запросов" hint="Как проверить, что всё доходит">
        <ul className="list-disc pl-5 space-y-1">
          <li>Ниже в «Последних запросах» — последние 100 событий проекта: время, тип, event_id и результат или текст ошибки.</li>
          <li>
            Ошибки 400/401 в журнал не попадают (запрос отклонён до обработки) — их видно только в ответе вашему сервису, логируйте ответы на своей
            стороне.
          </li>
          <li>
            Лиды и их атрибуция — в «Клиентах» проекта (карточка лида), отправка в рекламу — в логах пикселя, переписка — во вкладке «Чаты».
          </li>
        </ul>
      </Section>
    </Accordion>
  );
}
