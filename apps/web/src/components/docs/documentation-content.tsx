'use client';

// Полная документация по продукту — перенесена из отдельного HTML-артефакта в реальную
// страницу СРМ (запрос пользователя 2026-07-31: "документация должна появится в сайдбаре
// как страница отдельная в срм, потом будем ее еще обновлять"). Один shared-компонент на
// оба дерева (classic + Studio), см. тот же принцип у ClientDetailContent/PaymentModal —
// сложный виджет пишется один раз и импортируется в обе страницы-обёртки.
//
// Контент 1:1 портирован из docs.html-артефакта (8 категорий), скриншоты — реальные,
// сняты Playwright'ом с демо-компании и лежат статикой в public/docs/*.png (не base64 —
// не раздувать JS-бандл, см. существующий паттерн с ClientAvatar).

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Rocket,
  LayoutGrid,
  LayoutTemplate,
  Users,
  Send,
  Shield,
  CreditCard,
  Info,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Zap,
  Clock,
  Video,
  MessageCircle,
  GitBranch,
  Search,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';

// ---------------- palette per category ----------------
const COLORS: Record<
  string,
  { icon: string; badge: string; rail: string }
> = {
  start: { icon: 'text-blue-600 dark:text-blue-400', badge: 'bg-blue-100 dark:bg-blue-950/40', rail: 'bg-blue-600 dark:bg-blue-400' },
  projects: { icon: 'text-sky-600 dark:text-sky-400', badge: 'bg-sky-100 dark:bg-sky-950/40', rail: 'bg-sky-600 dark:bg-sky-400' },
  landings: { icon: 'text-emerald-600 dark:text-emerald-400', badge: 'bg-emerald-100 dark:bg-emerald-950/40', rail: 'bg-emerald-600 dark:bg-emerald-400' },
  clients: { icon: 'text-amber-600 dark:text-amber-400', badge: 'bg-amber-100 dark:bg-amber-950/40', rail: 'bg-amber-600 dark:bg-amber-400' },
  pushes: { icon: 'text-purple-600 dark:text-purple-400', badge: 'bg-purple-100 dark:bg-purple-950/40', rail: 'bg-purple-600 dark:bg-purple-400' },
  scenarios: { icon: 'text-indigo-600 dark:text-indigo-400', badge: 'bg-indigo-100 dark:bg-indigo-950/40', rail: 'bg-indigo-600 dark:bg-indigo-400' },
  team: { icon: 'text-pink-600 dark:text-pink-400', badge: 'bg-pink-100 dark:bg-pink-950/40', rail: 'bg-pink-600 dark:bg-pink-400' },
  billing: { icon: 'text-teal-600 dark:text-teal-400', badge: 'bg-teal-100 dark:bg-teal-950/40', rail: 'bg-teal-600 dark:bg-teal-400' },
};

// ---------------- small content primitives ----------------
function Sub({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold mt-8 mb-2.5 scroll-mt-24">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-foreground/90 mb-3">{children}</p>;
}

function Ol({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2 mb-4">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-sm leading-relaxed text-foreground/90">
          <span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-medium mt-0.5">
            {i + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Callout({ kind, label, children }: { kind: 'tip' | 'warn'; label: string; children: React.ReactNode }) {
  const Icon = kind === 'warn' ? AlertTriangle : Info;
  return (
    <div
      className={`flex gap-3 rounded-lg border p-3.5 mb-4 text-sm ${
        kind === 'warn'
          ? 'border-amber-300/60 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30'
          : 'border-blue-300/60 bg-blue-50 dark:border-blue-800/60 dark:bg-blue-950/30'
      }`}
    >
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${kind === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`} />
      <div>
        <b className="font-semibold">{label}</b>
        <span className="block text-foreground/80 mt-0.5">{children}</span>
      </div>
    </div>
  );
}

function FieldList({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="border rounded-lg divide-y mb-4 overflow-hidden">
      {rows.map(([name, desc], i) => (
        <div key={i} className="flex flex-col sm:flex-row sm:gap-4 p-3 text-sm">
          <div className="font-medium sm:w-40 shrink-0 mb-1 sm:mb-0">{name}</div>
          <div className="text-foreground/80 leading-relaxed">{desc}</div>
        </div>
      ))}
    </div>
  );
}

function Shot({ src, url, caption }: { src: string; url: string; caption: string }) {
  return (
    <figure className="rounded-lg border overflow-hidden mb-4 bg-muted/30">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b bg-muted/50">
        <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
        <span className="ml-2 text-xs text-muted-foreground font-mono truncate">{url}</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- статичный скриншот, не next/image, см. паттерн ClientAvatar */}
      <img src={src} alt={caption} className="w-full block" loading="lazy" />
      <figcaption className="px-3 py-2 text-xs text-muted-foreground border-t">{caption}</figcaption>
    </figure>
  );
}

function VennDiagram() {
  return (
    <div className="flex items-center justify-center gap-0 mb-4 py-2">
      <div className="w-40 h-40 rounded-full bg-blue-500/15 border-2 border-blue-500/40 flex items-center justify-center text-center text-xs font-medium -mr-10 text-blue-700 dark:text-blue-300">
        Проект А
        <br />
        клиенты
      </div>
      <div className="w-40 h-40 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40 flex items-center justify-center text-center text-xs font-medium -ml-10 text-emerald-700 dark:text-emerald-300">
        Проект Б
        <br />
        клиенты
      </div>
    </div>
  );
}

function ChainNode({ icon: Icon, label, sub }: { icon: LucideIcon; label: string; sub: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border bg-card px-3.5 py-2.5 text-center min-w-[120px]">
      <Icon className="w-4 h-4 text-primary" />
      <div className="text-xs font-medium">{label}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{sub}</div>
    </div>
  );
}

function ChainArrow() {
  return <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />;
}

function ChainDiagram() {
  return (
    <div className="rounded-lg border bg-muted/20 p-4 mb-4 space-y-3 overflow-x-auto">
      <div className="flex items-center gap-2 min-w-max">
        <ChainNode icon={Zap} label="Первый депозит" sub="триггер" />
        <ChainArrow />
        <ChainNode icon={Clock} label="30 минут" sub="задержка" />
        <ChainArrow />
        <ChainNode icon={Video} label="Видео-кружок" sub="элемент" />
      </div>
      <div className="flex items-center gap-2 min-w-max">
        <ChainArrow />
        <ChainNode icon={GitBranch} label="Открыл?" sub="условие" />
      </div>
      <div className="flex items-center justify-center gap-4 min-w-max">
        <ChainNode icon={MessageCircle} label="Апсейл" sub="да" />
        <ChainNode icon={MessageCircle} label="Напоминание" sub="нет" />
      </div>
    </div>
  );
}

function RolesGrid() {
  const roles: [string, string][] = [
    ['Owner', 'Владелец компании. Полный доступ ко всему, включая биллинг и удаление компании. Всегда ровно один на компанию.'],
    ['Admin', 'Полный доступ ко всем проектам и команде, кроме биллинга и необратимых действий (архивация, удаление компании).'],
    ['Buyer', 'Байер — лендинги, пиксели, рассылки, статистика и выручка, но только по проектам, к которым выдан доступ.'],
    ['Operator', 'Работа с клиентами и депозитами по своим проектам — без доступа к рекламной атрибуции по умолчанию.'],
    ['Operator-admin', 'Управляет учётками Operator в пределах своих же проектов — создаёт их, настраивает права, но не видит остального, что видит Admin.'],
  ];
  return (
    <div className="grid sm:grid-cols-2 gap-3 mb-4">
      {roles.map(([name, desc]) => (
        <div key={name} className="rounded-lg border p-3.5">
          <div className="flex items-center gap-2 font-semibold text-sm mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            {name}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
        </div>
      ))}
    </div>
  );
}

function PermTable() {
  const rows: [string, ...boolean[]][] = [
    ['Просмотр клиентов', true, true, true, true, true],
    ['Изменение клиентов / депозиты', true, true, false, true, false],
    ['Источник трафика клиента', true, true, true, false, false],
    ['Лендинги, пиксели, рассылки', true, true, true, false, false],
    ['Выручка и лидерборды', true, true, true, false, false],
    ['Управление командой', true, true, false, false, true],
  ];
  const heads = ['', 'Owner', 'Admin', 'Buyer', 'Operator', 'Op-admin'];
  return (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-xs border rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-muted/50">
            {heads.map((h, i) => (
              <th key={i} className={`p-2.5 font-medium ${i === 0 ? 'text-left' : 'text-center'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, ...vals]) => (
            <tr key={label} className="border-t">
              <td className="p-2.5 font-medium">{label}</td>
              {vals.map((v, i) => (
                <td key={i} className="p-2.5 text-center">
                  {v ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 inline-block" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-muted-foreground/40 inline-block" />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="px-1 py-0.5 rounded bg-muted font-mono text-[0.85em]">{children}</code>;
}

// ---------------- content model ----------------
interface DocSection {
  id: string;
  cat: string;
  icon: LucideIcon;
  title: string;
  lede: string;
  links: string[];
  body: React.ReactNode;
}

const SECTIONS: DocSection[] = [
  {
    id: 'start',
    cat: 'Начало работы',
    icon: Rocket,
    title: 'Начало работы',
    lede: 'Что происходит в первые 10 минут после регистрации — и почему порядок действий именно такой.',
    links: ['Регистрация и бесплатный тариф', 'Первый проект', 'Что дальше'],
    body: (
      <>
        <Sub>Регистрация и бесплатный тариф</Sub>
        <P>
          Регистрация не требует карты — компания сразу получает тариф <Code>TRIAL</Code> (1 проект, 1000 клиентов, 2
          рассылки в день). Этого достаточно, чтобы полностью пройти цикл: создать проект, подключить Telegram, привести
          первых клиентов и увидеть реальную воронку — прежде чем платить.
        </P>
        <Callout kind="tip" label="Совет">
          TRIAL действует ограниченное время. Тариф можно сменить в любой момент на странице «Подписка» — повышение
          применяется мгновенно, без ожидания следующего периода.
        </Callout>
        <Sub>Первый проект</Sub>
        <Ol
          items={[
            <>Откройте «Проекты» → «Создать проект».</>,
            <>
              Введите название (это же название потом можно сменить, оно не влияет на технические настройки) и
              выберите часовой пояс — по нему будут считаться «сутки» на всех графиках проекта.
            </>,
            <>
              Настройте канал — MWTRACK устроен так, что <b>проект и канал — одно и то же</b>: при создании проекта вы
              сразу выбираете тип канала (сейчас полноценно работает Telegram) и его параметры. Отдельного шага
              «привязать канал позже» нет — это осознанное решение, оно исключает состояние «проект есть, а канала
              нет».
            </>,
            <>После сохранения бот сам подтягивает название и аватар канала — переименовывать вручную не нужно.</>,
          ]}
        />
        <Shot
          src="/docs/overview.png"
          url="mw-track.com/projects/…"
          caption="Обзор проекта сразу после подключения — воронка, разбивка по рекламе, динамика по дням. Пример с демо-данными для иллюстрации."
        />
        <Sub>Что дальше</Sub>
        <P>
          Дальше обычный порядок такой: подключить домен → собрать лендинг → получить трекинг-ссылку → запустить
          рекламу → смотреть, как клиенты доходят до диалога и депозита. Каждый шаг — отдельный раздел ниже.
        </P>
      </>
    ),
  },
  {
    id: 'projects',
    cat: 'Проекты и каналы',
    icon: LayoutGrid,
    title: 'Проекты и каналы',
    lede: 'Один проект = один канал. Настройки, часовой пояс, пиксели и переключатели трекинга живут здесь.',
    links: ['Проект — это канал', 'Настройки проекта', 'Пиксели и трекинг событий', 'Личный Telegram-аккаунт'],
    body: (
      <>
        <Sub>Проект — это канал</Sub>
        <P>
          В большинстве CRM «проект» и «канал» — разные сущности, которые нужно связывать вручную. В MWTRACK это одна и
          та же сущность с самого создания: выбор типа канала — часть формы создания проекта, а не отдельная настройка.
          Это упрощает права доступа (выдавая доступ к проекту, вы автоматически выдаёте доступ к его каналу) и убирает
          целый класс ошибок «канал не привязан».
        </P>
        <Sub>Настройки проекта</Sub>
        <P>Страница настроек разбита на вкладки:</P>
        <Shot
          src="/docs/project-settings.png"
          url="mw-track.com/projects/…/settings"
          caption="Вкладки настроек проекта: Основные, Каналы, Пиксели, Логи, События, Интеграция, Опасная зона."
        />
        <FieldList
          rows={[
            [
              'Основные',
              'Название, описание, часовой пояс. Часовой пояс влияет на границы «суток» во всех дневных графиках — важно выставить правильно, если аудитория проекта на другом конце света.',
            ],
            ['Каналы', 'Параметры Telegram-бота: токен, режим (обычный бот / приватный канал по заявке / личный аккаунт).'],
            ['Пиксели', 'Facebook и TikTok — привязка Pixel ID и токена конверсий (CAPI), тестовый режим отправки событий.'],
            ['Логи', 'Технический журнал доставки событий в рекламные кабинеты — полезно, когда конверсии «не долетают».'],
            [
              'События',
              'Переключатели: отправлять ли в Facebook/TikTok события «Подписка», «Диалог», «Покупка» автоматически. Ручные действия сотрудника (кнопка «Зарегистрировать диалог», форма «Добавить покупку») всегда долетают до рекламных кабинетов, даже если переключатель выключен — это защита от случайной потери реальной конверсии.',
            ],
            [
              'Интеграция',
              <>
                Кастомные имена query-параметров трекинг-ссылки — чтобы одинаковый паттерн вида{' '}
                <Code>?pixel=&amp;ad_id=</Code> у всех клиентов платформы не считывался автоматически спай-сервисами
                конкурентов.
              </>,
            ],
            ['Опасная зона', 'Архивация проекта и перегенерация токенов — необратимые действия, доступны только Owner и Admin.'],
          ]}
        />
        <Sub>Пиксели и трекинг событий</Sub>
        <P>
          События (<Code>PageView</Code>, <Code>Lead</Code>, <Code>Subscribe</Code>, <Code>InitiateCheckout</Code>,{' '}
          <Code>Purchase</Code>, <Code>Click</Code>) сначала пишутся в собственную базу MWTRACK — это происходит
          всегда, независимо ни от каких настроек. Отправка в Facebook и TikTok идёт асинхронно, через очередь, и не
          может замедлить или сломать основной сценарий клиента, даже если рекламная площадка недоступна.
        </P>
        <Sub>Личный Telegram-аккаунт</Sub>
        <P>
          Отдельно от бота можно подключить личный Telegram-аккаунт менеджера — тогда MWTRACK видит настоящий диалог с
          клиентом (входящие сообщения) напрямую, без необходимости, чтобы клиент писал именно боту. Это единственный
          способ честно отследить момент первого ответа для проектов, где общение идёт из личных сообщений, а не через
          бота.
        </P>
      </>
    ),
  },
  {
    id: 'landings',
    cat: 'Лендинги и домены',
    icon: LayoutTemplate,
    title: 'Лендинги и домены',
    lede: 'От готового шаблона до собственного домена с SSL — и трекинг-ссылка, которая не теряет данные по пути в рекламный кабинет.',
    links: [
      'Создание лендинга',
      'Трекинг-ссылка: пиксель и рекламные макросы',
      'A/B-тестирование лендингов',
      'Подключение домена',
      'Привязка пути к лендингу',
    ],
    body: (
      <>
        <Sub>Создание лендинга</Sub>
        <P>
          Три способа: выбрать готовый шаблон (можно менять цвета, тексты, изображения без правки кода), загрузить свой
          ZIP-архив, либо подключить внешний лендинг клиента через SDK. Карточка лендинга сразу показывает статус,
          количество подписчиков и быстрые действия.
        </P>
        <Shot
          src="/docs/landings.png"
          url="mw-track.com/projects/…/landings"
          caption="Список лендингов проекта — статус публикации, шаблон, число подписчиков, быстрые действия."
        />
        <Sub>Трекинг-ссылка: пиксель и рекламные макросы</Sub>
        <P>
          Кнопка «Получить ссылку» на карточке лендинга формирует ссылку вида{' '}
          <Code>https://домен/путь?pixel=ID&amp;ad_id=&#123;&#123;ad.id&#125;&#125;&amp;campaign_id=&#123;&#123;campaign.id&#125;&#125;…</Code>{' '}
          — вставляется в Ads Manager как destination URL. Facebook и TikTok сами подставляют реальные значения
          макросов при показе объявления, поэтому в CRM клиент приходит уже с полным набором данных: объявление,
          группа объявлений, кампания, площадка.
        </P>
        <Callout kind="tip" label="Важно">
          Имена query-параметров можно переименовать в настройках проекта (вкладка «Интеграция») — так рекламные
          аккаунты разных клиентов платформы не выглядят одинаково для внешних скрейперов.
        </Callout>
        <Sub>A/B-тестирование лендингов</Sub>
        <P>
          Группа A/B-теста объединяет несколько уже существующих лендингов с указанным весом трафика на каждый —
          например, 50/50 или 70/30. Разбивка происходит на каждый запрос без cookie (важно для рекламного трафика,
          где сессии короткие и cookie ненадёжны), статистика по конверсии сравнивается в реальном времени.
        </P>
        <Sub>Подключение домена</Sub>
        <P>Домен вы покупаете и настраиваете сами — в своём Cloudflare-аккаунте или у любого другого регистратора. Порядок:</P>
        <Ol
          items={[
            <>Добавьте домен на странице «Домены».</>,
            <>
              Пропишите три DNS-записи по инструкции в интерфейсе — включая A-запись на <Code>www</Code>: сертификат
              выпускается сразу на домен с <Code>www</Code> и без, без записи на <Code>www</Code> выпуск сертификата не
              пройдёт.
            </>,
            <>Нажмите «Проверить» — MWTRACK подтвердит владение доменом и автоматически выпустит SSL-сертификат.</>,
          ]}
        />
        <Shot src="/docs/domains.png" url="mw-track.com/domains" caption="Домен подключён и активен — SSL выпущен, осталось привязать путь." />
        <Sub>Привязка пути к лендингу</Sub>
        <P>
          Голый домен никуда не ведёт осознанно — нужно явно привязать путь (например, <Code>/promo1</Code>) к
          конкретному лендингу или сразу к целой A/B-группе. Один домен может обслуживать пути из разных проектов
          одновременно.
        </P>
      </>
    ),
  },
  {
    id: 'clients',
    cat: 'Клиенты и диалоги',
    icon: Users,
    title: 'Клиенты и диалоги',
    lede: 'Список, карточка, депозиты и пересечение аудиторий между проектами.',
    links: ['Список клиентов', 'Карточка клиента', 'Первый и повторный депозит', 'Пересечение аудиторий', 'Экспорт под Lookalike'],
    body: (
      <>
        <Sub>Список клиентов</Sub>
        <P>
          Таблица со статусом подписки, статусом бота, моментом и задержкой первого диалога, суммой потраченного.
          Переключатель «Наши клиенты / Внешние контакты» разделяет тех, кто пришёл по трекинг-ссылке, от тех, кто
          просто написал боту напрямую — вторые не влияют на статистику воронки, но диалог с ними всё равно виден.
        </P>
        <Shot
          src="/docs/clients.png"
          url="mw-track.com/projects/…/clients"
          caption="Список клиентов с фильтрами, статусом бота и таймингом первого диалога."
        />
        <Sub>Карточка клиента</Sub>
        <P>Открывается кликом по строке. Помимо базовых данных — полный след атрибуции:</P>
        <Shot
          src="/docs/client-detail.png"
          url="mw-track.com/projects/…/clients"
          caption="Карточка клиента: источник трафика (баер, пиксель, кампания, объявление, UTM), финансы, история покупок."
        />
        <FieldList
          rows={[
            [
              'Источник трафика',
              'Баер, пиксель, лендинг, кампания, объявление, группа объявлений, площадка, все 5 UTM-полей, fbclid/ttclid — то, что обычно теряется между рекламным кабинетом и CRM.',
            ],
            ['Финансы', 'Всего потрачено, число покупок, форма ручного добавления депозита.'],
            ['История покупок', 'Список всех депозитов клиента с датой и суммой.'],
          ]}
        />
        <Callout kind="warn" label="По ролям">
          Раздел «Источник трафика» виден не всем — Operator по умолчанию его не видит вообще (есть только факт, что
          клиент пришёл откуда-то), Owner и Admin видят всегда. Настраивается в разделе «Команда и права».
        </Callout>
        <Sub>Первый и повторный депозит (ФД / РД)</Sub>
        <P>
          MWTRACK различает первый депозит клиента и все последующие — это готовая концепция, а не пользовательское
          событие, которое нужно самим настраивать. Воронка на странице проекта показывает оба показателя отдельно, с
          конверсией на каждом шаге.
        </P>
        <Sub>Пересечение аудиторий</Sub>
        <VennDiagram />
        <P>
          Если один и тот же человек (по Telegram user id) есть в клиентах сразу двух проектов компании, это видно
          двумя способами: отдельная страница «Пересечение аудиторий» — матрица проект×проект, и метка прямо в списке
          клиентов проекта.
        </P>
        <P>
          Видимость детали регулируется правом <Code>CLIENTS_VIEW_CROSS_PROJECT</Code>, которое выдаётся на конкретном
          проекте: с этим правом сотрудник видит, в каком именно другом проекте встречается клиент и был ли там диалог;
          без права — только сам факт пересечения и было ли где-то диалог, без названия проекта.
        </P>
        <Sub>Экспорт под Lookalike</Sub>
        <P>
          Кнопка «Экспорт» на странице клиентов выгружает CSV с email/телефоном/страной — готово для загрузки в
          рекламный кабинет как Custom Audience для построения похожей аудитории. Telegram ID в выгрузку не попадает
          намеренно — Facebook его не понимает.
        </P>
      </>
    ),
  },
  {
    id: 'pushes',
    cat: 'Рассылки',
    icon: Send,
    title: 'Рассылки',
    lede: 'От разовой рассылки до расписания на месяц вперёд — с фильтрами аудитории и подсказкой лучшего времени отправки.',
    links: ['Создание рассылки', 'Фильтры аудитории', 'Расписание и календарь', 'Smart Push Timing'],
    body: (
      <>
        <Sub>Создание рассылки</Sub>
        <P>
          Мастер из трёх шагов: контент (текст с поддержкой HTML-тегов Telegram, до 10 медиафайлов альбомом, до 3
          кнопок, живой предпросмотр), аудитория (фильтры), подтверждение.
        </P>
        <Shot
          src="/docs/push-new.png"
          url="mw-track.com/projects/…/pushes/new"
          caption="Шаг «Контент» — текст, подстановки {first_name}/{last_name}, медиа, кнопки, предпросмотр в реальном времени."
        />
        <P>
          В тексте можно использовать плейсхолдеры <Code>{'{first_name}'}</Code>, <Code>{'{last_name}'}</Code>,{' '}
          <Code>{'{full_name}'}</Code>, <Code>{'{username}'}</Code> — при отправке они подставляются реальными
          данными клиента, а если данных нет — просто становятся пустой строкой, рассылка не ломается.
        </P>
        <Sub>Фильтры аудитории</Sub>
        <P>
          Перед отправкой видно два числа: «всего по фильтру» и «реально доступно» — второе учитывает, что часть
          клиентов отписалась или заблокировала бота. Рассылка физически не может уйти тем, кто не может её получить.
        </P>
        <Sub>Расписание и календарь</Sub>
        <P>
          Рассылку можно отправить сразу или запланировать на конкретное время. Общий календарь по всем проектам
          компании сразу показывает, что и когда запланировано — удобно, чтобы не отправить два промо одному и тому же
          клиенту в один день из разных проектов.
        </P>
        <Shot src="/docs/calendar.png" url="mw-track.com/pushes-calendar" caption="Календарь рассылок по всем проектам компании — планирование в одном месте." />
        <Shot src="/docs/pushes.png" url="mw-track.com/projects/…/pushes" caption="История рассылок проекта — статус, охват, доставлено, ошибки." />
        <Sub>Smart Push Timing</Sub>
        <P>
          После накопления статистики по кликам на кнопки в рассылках, MWTRACK считает CTR по часам дня и подсказывает,
          в какое время аудитория конкретного проекта реагирует лучше всего — прямо на странице «Рассылки». Данные
          появляются постепенно, начиная с первых рассылок с кнопками.
        </P>
      </>
    ),
  },
  {
    id: 'scenarios',
    cat: 'Бот-сценарии',
    icon: MessageCircle,
    title: 'Бот-сценарии',
    lede: 'Автоматические цепочки сообщений, которые реагируют на поведение клиента — без участия разработчика.',
    links: ['Триггеры', 'Элементы сценария', 'Видео-кружки', 'A/B-тестирование сценариев'],
    body: (
      <>
        <Sub>Триггеры</Sub>
        <P>
          Сценарий запускается автоматически по одному из событий: подписка на канал, первый депозит, повторный
          депозит, отписка, команда бота (например, <Code>/price</Code>) — либо срабатывает по умолчанию, если ни одна
          команда не подошла.
        </P>
        <ChainDiagram />
        <Sub>Элементы сценария</Sub>
        <P>
          Редактор устроен как список «элементов» — у каждого один тип контента (текст / фото / видео / видео-кружок /
          альбом) и опциональная кнопка. Задержка перед следующим элементом настраивается тут же, не отдельным шагом —
          визуально это выглядит как понятная цепочка сверху вниз.
        </P>
        <Sub>Видео-кружки</Sub>
        <P>
          Любое загруженное видео автоматически перекодируется в формат видео-кружка (квадрат, нужный битрейт) — не
          нужно заранее готовить файл в правильном формате, конвертация происходит на сервере при загрузке.
        </P>
        <Sub>A/B-тестирование сценариев</Sub>
        <P>
          Работает так же, как A/B-тест лендингов: несколько вариантов сценария с указанным весом, случайный выбор
          варианта при каждом срабатывании триггера (без «прилипания» одного клиента к одному варианту), статистика
          конверсии — 6 показателей по каждому варианту.
        </P>
      </>
    ),
  },
  {
    id: 'team',
    cat: 'Команда и права',
    icon: Shield,
    title: 'Команда и права',
    lede: 'Пять ролей, 33 разрешения, права выдаются по каждому проекту отдельно — не «всё или ничего».',
    links: ['Роли', 'Разрешения по проектам', 'Что видит каждая роль', 'Приглашение участника', 'Аналитика по байерам'],
    body: (
      <>
        <Sub>Роли</Sub>
        <RolesGrid />
        <Sub>Разрешения по проектам</Sub>
        <P>
          33 отдельных разрешения (просмотр/создание/изменение/удаление для лендингов, пикселей, доменов, рассылок,
          автоворонок, A/B-тестов, клиентов и так далее) выдаются индивидуально для каждого сотрудника на каждом
          конкретном проекте — Байер может иметь разные права на двух разных проектах одной компании. Домены —
          единственное исключение: право на домены общее для сотрудника, не привязано к одному проекту, потому что один
          домен технически может обслуживать пути разных проектов сразу.
        </P>
        <Sub>Что видит каждая роль</Sub>
        <P>Ниже — типичный набор прав по умолчанию (Owner может донастроить вручную под конкретного сотрудника):</P>
        <PermTable />
        <Sub>Приглашение участника</Sub>
        <P>
          Два способа: создать аккаунт вручную с временным паролем, либо сгенерировать одноразовую ссылку-приглашение
          (действует 7 дней) — человек сам придумает себе пароль по ней. Проекты и права выдаются в той же форме.
        </P>
        <Shot src="/docs/team-new.png" url="mw-track.com/team/new" caption="Форма добавления участника — роль, проекты, разрешения по каждому проекту." />
        <Shot src="/docs/team.png" url="mw-track.com/team" caption="Список команды, статистика по байерам и сравнение проектов — прямо на странице «Команда»." />
        <Sub>Аналитика по байерам</Sub>
        <P>
          На той же странице — лидерборд байеров (сколько клиентов привёл, какая выручка) и сравнение проектов
          компании. Атрибуция байера к клиенту работает через скрытый параметр трекинг-ссылки, а не через владение
          лендингом — так несколько байеров могут использовать общий лендинг, и система всё равно корректно разделит
          их трафик.
        </P>
      </>
    ),
  },
  {
    id: 'billing',
    cat: 'Подписка и оплата',
    icon: CreditCard,
    title: 'Подписка и оплата',
    lede: 'Тарифы считаются по проектам, клиентам и рассылкам в день — баланс пополняется криптовалютой.',
    links: ['Тарифы и лимиты', 'Пополнение баланса', 'Автопродление'],
    body: (
      <>
        <Sub>Тарифы и лимиты</Sub>
        <P>
          Каждый тариф ограничивает три параметра: количество проектов, количество клиентов и количество рассылок в
          день. Текущее использование по всем трём видно на странице «Подписка» в виде прогресс-баров.
        </P>
        <Shot src="/docs/billing.png" url="mw-track.com/billing" caption="Страница подписки — баланс, использование лимитов, карточки тарифов." />
        <Sub>Пополнение баланса</Sub>
        <P>
          Оплата — криптовалютой (USDT, сети TRC-20 / ERC-20 / BEP-20). При создании счёта на пополнение появляется
          адрес и QR-код для перевода, счёт действует 30 минут. Система сама отслеживает поступление платежа в
          блокчейне — подтверждать вручную не обязательно, но кнопка «Я оплатил» ускоряет проверку.
        </P>
        <Sub>Автопродление</Sub>
        <P>
          Тариф продлевается автоматически списанием с баланса в момент истечения текущего периода. Если средств не
          хватает — компания не блокируется полностью, а мягко переводится на бесплатный TRIAL, с которого можно снова
          оплатить платный тариф в любой момент.
        </P>
      </>
    ),
  },
];

// ---------------- main component ----------------
export function DocumentationContent() {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 },
    );
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (s) => s.cat.toLowerCase().includes(q) || s.title.toLowerCase().includes(q) || s.links.some((l) => l.toLowerCase().includes(q)),
    );
  }, [query]);

  function scrollTo(id: string) {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMobileNavOpen(false);
  }

  return (
    <div className="flex gap-8 relative">
      {/* Мобильный тумблер — сайдбар скрыт по умолчанию < 960px, тот же принцип off-canvas
          drawer'а, что у docs.html-артефакта. */}
      <button
        type="button"
        onClick={() => setMobileNavOpen((v) => !v)}
        className="lg:hidden fixed bottom-4 right-4 z-30 w-11 h-11 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
        aria-label="Оглавление"
      >
        {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {mobileNavOpen && <div className="lg:hidden fixed inset-0 bg-black/40 z-20" onClick={() => setMobileNavOpen(false)} />}

      <aside
        className={`shrink-0 w-64 lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)] lg:overflow-y-auto lg:translate-x-0 lg:opacity-100 lg:pointer-events-auto lg:relative
          fixed inset-y-0 left-0 z-30 bg-card border-r lg:border-r-0 p-4 lg:p-0 transition-transform duration-200
          ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'} lg:block`}
      >
        <div className="relative mb-4">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по документации…" className="pl-8 h-8 text-sm" />
        </div>
        <nav className="space-y-4">
          {filteredSections.map((s) => {
            const col = COLORS[s.id];
            return (
              <div key={s.id}>
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground/80 mb-1.5">
                  <span className={`w-5 h-5 rounded-md flex items-center justify-center ${col.badge} ${col.icon}`}>
                    <s.icon className="w-3 h-3" />
                  </span>
                  {s.cat}
                </div>
                <div className="ml-1.5 pl-4 border-l space-y-0.5">
                  {s.links.map((label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => scrollTo(s.id)}
                      className={`block w-full text-left text-xs py-1 px-2 rounded-md truncate transition-colors ${
                        activeId === s.id ? 'text-primary font-medium bg-primary/10' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {filteredSections.length === 0 && <p className="text-xs text-muted-foreground px-1">Ничего не найдено.</p>}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 max-w-3xl pb-24">
        {SECTIONS.map((s) => {
          const col = COLORS[s.id];
          return (
            <section
              key={s.id}
              id={s.id}
              ref={(el) => {
                sectionRefs.current[s.id] = el;
              }}
              className="scroll-mt-20 pt-2 pb-10 border-b last:border-b-0"
            >
              <div className="flex items-center gap-2.5 mb-2">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${col.badge} ${col.icon}`}>
                  <s.icon className="w-4 h-4" />
                </span>
                <h2 className="text-xl font-bold">{s.title}</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-5">{s.lede}</p>
              {s.body}
            </section>
          );
        })}
      </div>
    </div>
  );
}
