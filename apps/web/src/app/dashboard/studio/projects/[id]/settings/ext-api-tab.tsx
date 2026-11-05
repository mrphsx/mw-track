'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { API_BASE_URL } from '@/lib/api-base-url';
import { STUDIO_CARD, StudioLinkButton } from '../../../ui';

// Единый API событий (2026-11-05): любой проект — бот на внешней платформе, своя воронка, сайт —
// присылает лидов и их события, а CRM считает статистику и отправляет события в FB/TikTok.

const FG = 'text-[#131A24] dark:text-[#E9EDF3]';
const MUTED = 'text-[#5F6B7A] dark:text-[#92A0AF]';
const CODE = 'rounded-lg bg-[#0F1620] text-[#E9EDF3] text-xs p-3 overflow-x-auto whitespace-pre font-mono';

const EVENTS: [string, string][] = [
  ['start', 'Лид нажал «Старт» у бота. Передайте start_code — код из /start: по нему подтянется вся атрибуция лендинга, лид засчитается, в FB уйдёт Subscribe.'],
  ['lead', 'Новый лид из любой воронки (форма, другой канал). Можно без Telegram — по external_id, phone или email. В FB — Subscribe.'],
  ['subscribe', 'Подписался на канал — как lead.'],
  ['unsubscribe', 'Отписался.'],
  ['message_in', 'Сообщение лида. Первое засчитывается как «Диалог» (в FB — Dialogue), текст видно в чате CRM.'],
  ['message_out', 'Ответ бота — только в переписку CRM.'],
  ['bot_blocked / bot_unblocked', 'Лид заблокировал / разблокировал бота.'],
  ['contact', 'Обновить телефон, email, имя — без событий.'],
  ['purchase', 'Покупка: amount, currency, purchase_id. ФД или РД определяется сам, в FB — Purchase. Повтор с тем же purchase_id не задвоится.'],
];

interface LogRow {
  id: string;
  eventId: string | null;
  type: string;
  ok: boolean;
  error: string | null;
  clientId: string | null;
  createdAt: string;
}

export function ExtApiTab({ projectId }: { projectId: string }) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState('');
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.get<{ secretKey: string; name: string }>(`/projects/${projectId}`)).data,
  });
  const { data: logs, refetch, isFetching } = useQuery({
    queryKey: ['ext-api-logs', projectId],
    queryFn: async () => (await api.get<LogRow[]>(`/projects/${projectId}/ext-api/logs`)).data,
  });
  const key = project?.secretKey ?? '';
  const base = API_BASE_URL.replace(/\/$/, '');
  const copy = (label: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 1500);
  };

  const curlStart = `curl -X POST ${base}/ext/event \\
  -H "X-Api-Key: ${reveal ? key : 'sk_live_…'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "start",
    "event_id": "start-123456789",
    "tg_user_id": 123456789,
    "username": "ana_maria",
    "first_name": "Ana",
    "start_code": "Kx7f2aB9"
  }'`;
  const curlBatch = `curl -X POST ${base}/ext/events \\
  -H "X-Api-Key: ${reveal ? key : 'sk_live_…'}" \\
  -H "Content-Type: application/json" \\
  -d '{ "events": [
    { "type": "message_in", "event_id": "m-1", "tg_user_id": 123456789, "text": "Hola" },
    { "type": "purchase", "event_id": "p-1", "tg_user_id": 123456789,
      "amount": 50, "currency": "USD", "purchase_id": "order-981" }
  ] }'`;
  const curlLead = `curl -X POST ${base}/ext/event \\
  -H "X-Api-Key: ${reveal ? key : 'sk_live_…'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "lead",
    "external_id": "crm-5521",
    "phone": "+50688880000",
    "email": "ana@mail.com",
    "attribution": { "fbclid": "IwAR…", "utm_source": "facebook",
                     "campaign_name": "Spring", "buyer": "a1B2c3" }
  }'`;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className={`${STUDIO_CARD} p-5 space-y-3`}>
        <h3 className={`font-semibold ${FG}`}>API событий</h3>
        <p className={`text-sm ${MUTED}`}>
          Сюда ваш внешний сервис (бот на другой платформе, своя воронка, сайт) присылает лидов и их события. CRM привязывает рекламную
          атрибуцию, считает лидов, диалоги и депозиты в статистике и отправляет события в Facebook и TikTok — как для подключённого бота.
        </p>
        <div className="grid gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`w-24 ${MUTED}`}>Адрес</span>
            <code className={`font-mono ${FG}`}>{base}/ext/event</code>
            <button type="button" onClick={() => copy('url', `${base}/ext/event`)} className={`${MUTED} hover:text-[#1F4E9C]`} aria-label="Скопировать">
              <Copy className="w-3.5 h-3.5" />
            </button>
            <span className={`text-xs ${MUTED}`}>(пачкой до 100 — {base}/ext/events)</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`w-24 ${MUTED}`}>Ключ</span>
            <code className={`font-mono ${FG} break-all`}>{reveal ? key : key ? `${key.slice(0, 10)}••••••••••••` : '…'}</code>
            <button type="button" onClick={() => setReveal((v) => !v)} className={`${MUTED} hover:text-[#1F4E9C]`} aria-label="Показать ключ">
              {reveal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
            <button type="button" onClick={() => copy('key', key)} className={`${MUTED} hover:text-[#1F4E9C]`} aria-label="Скопировать ключ">
              <Copy className="w-3.5 h-3.5" />
            </button>
            {copied && <span className="text-xs text-emerald-600">Скопировано</span>}
          </div>
          <p className={`text-xs ${MUTED}`}>
            Передавайте ключ в заголовке <code>X-Api-Key</code> (или <code>Authorization: Bearer …</code>). Это секретный ключ проекта — он же во
            вкладке «Интеграция», там же его можно перевыпустить. Проверить ключ: <code>GET {base}/ext/ping</code>.
          </p>
        </div>
      </div>

      <div className={`${STUDIO_CARD} p-5 space-y-3`}>
        <h3 className={`font-semibold ${FG}`}>Как привязать лида к рекламе</h3>
        <p className={`text-sm ${MUTED}`}>
          Кнопка лендинга ведёт на бота ссылкой <code>t.me/бот?start=КОД</code> — лид код не видит, Telegram передаёт его боту при нажатии
          «Старт». Ваш сервис получает его как параметр команды /start и присылает нам в <code>start_code</code> события <code>start</code>. Если
          лид пришёл не с нашего лендинга, передайте метки в <code>attribution</code>.
        </p>
        <p className={`text-sm ${MUTED}`}>
          Кто это — <code>tg_user_id</code> (Telegram ID), или <code>external_id</code> (ID в вашей системе), или <code>phone</code> /{' '}
          <code>email</code>. <code>event_id</code> — ваш уникальный ID события: повтор с тем же ID не задвоится, его можно безопасно
          переотправить.
        </p>
      </div>

      <div className={`${STUDIO_CARD} p-5 space-y-2`}>
        <h3 className={`font-semibold ${FG}`}>События (type)</h3>
        <div className="divide-y divide-[#DCE1E8] dark:divide-white/10 text-sm">
          {EVENTS.map(([t, d]) => (
            <div key={t} className="py-2 flex flex-col sm:flex-row gap-1 sm:gap-4">
              <code className={`w-48 shrink-0 font-mono font-semibold ${FG}`}>{t}</code>
              <span className={MUTED}>{d}</span>
            </div>
          ))}
        </div>
        <p className={`text-xs ${MUTED}`}>
          Ответ — <code>{'{ ok, client_id, attributed, error }'}</code> на каждое событие. Ошибка в одном событии пачки не мешает остальным.
          Поля, которых нет в описании, отклоняются.
        </p>
      </div>

      <div className={`${STUDIO_CARD} p-5 space-y-3`}>
        <div className="flex items-center gap-3">
          <h3 className={`font-semibold ${FG}`}>Примеры</h3>
          <button type="button" onClick={() => setReveal((v) => !v)} className="text-xs text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline">
            {reveal ? 'Скрыть ключ в примерах' : 'Подставить ключ в примеры'}
          </button>
        </div>
        {[
          ['Лид нажал «Старт» с кодом из лендинга', curlStart],
          ['Сообщение и покупка пачкой', curlBatch],
          ['Лид без Telegram из другой воронки', curlLead],
        ].map(([title, code]) => (
          <div key={title} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${FG}`}>{title}</span>
              <button type="button" onClick={() => copy(title, code)} className={`${MUTED} hover:text-[#1F4E9C]`} aria-label="Скопировать пример">
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
            <pre className={CODE}>{code}</pre>
          </div>
        ))}
      </div>

      <div className={`${STUDIO_CARD} p-5 space-y-3`}>
        <div className="flex items-center gap-3">
          <h3 className={`font-semibold ${FG}`}>Последние запросы</h3>
          <StudioLinkButton size="sm" icon={RefreshCw} onClick={() => refetch()} disabled={isFetching}>
            Обновить
          </StudioLinkButton>
        </div>
        {!logs?.length ? (
          <p className={`text-sm ${MUTED}`}>Запросов ещё не было.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`text-left text-xs ${MUTED}`}>
                  <th className="py-1.5 pr-3 font-medium">Время</th>
                  <th className="py-1.5 pr-3 font-medium">Событие</th>
                  <th className="py-1.5 pr-3 font-medium">event_id</th>
                  <th className="py-1.5 font-medium">Результат</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className={`py-1.5 pr-3 whitespace-nowrap ${MUTED}`}>{format(new Date(l.createdAt), 'd MMM HH:mm:ss')}</td>
                    <td className={`py-1.5 pr-3 font-mono ${FG}`}>{l.type}</td>
                    <td className={`py-1.5 pr-3 font-mono text-xs ${MUTED} max-w-[160px] truncate`}>{l.eventId ?? '—'}</td>
                    <td className={`py-1.5 ${l.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {l.ok ? 'принято' : l.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
