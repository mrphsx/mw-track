'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

// Публичная домашняя страница (запрос пользователя 2026-08-04: мини-презентация + кнопки входа/
// регистрации до логина). Редизайн 2026-08-05 — исходная версия (иконки в квадратиках + сетка
// 3x2 карточек, badge-пилюля со звёздочкой над хироем) была прямым текстом названа пользователем
// "слишком нейроночной" — это ровно типовой AI-generated SaaS-лендинг паттерн. Вместо абстрактных
// иконок теперь настоящие кропы реальных скриншотов продукта (те же PNG, что уже используются в
// /docs, см. apps/web/public/docs/*.png — обрезаны через sharp в public/marketing/*.png, убраны
// пустые поля и тестовое название проекта в шапке) внутри лёгкой рамки браузера — сразу видно,
// что это работающий продукт, а не мокап. Секции идут чередующимся блоком (текст | скриншот,
// скриншот | текст) вместо симметричной сетки одинаковых карточек.

function BrowserFrame({ src, alt, address }: { src: string; alt: string; address: string }) {
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 shadow-xl shadow-black/5 dark:shadow-black/40 overflow-hidden bg-white dark:bg-[#171F2B]">
      <div className="flex items-center gap-3 px-3 py-2 bg-[#EEF1F5] dark:bg-[#0F1620] border-b border-black/5 dark:border-white/5">
        <div className="flex gap-1.5 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-[#E5645A]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#E8B23D]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#5FB77E]" />
        </div>
        <div className="flex-1 text-center text-[11px] font-mono text-[#8A93A0] truncate px-8">{address}</div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="w-full h-auto block" />
    </div>
  );
}

function Logo() {
  return (
    <span className="text-xl font-bold tracking-tight text-[#131A24] dark:text-white">
      MW<span className="text-[#1F4E9C] dark:text-[#7BA9EE]">TRACK</span>
    </span>
  );
}

interface Section {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  image: { src: string; alt: string; address: string };
  reverse?: boolean;
}

const SECTIONS: Section[] = [
  {
    eyebrow: 'Клиенты',
    title: 'Каждый подписчик — с историей, а не просто строчкой',
    description:
      'Диалог, статус бота, дата подписки, потрачено — всё в одной таблице. Открываете карточку и видите байера, кампанию, объявление, UTM-метки и fbclid, по которым он пришёл.',
    bullets: ['Свои клиенты и внешние контакты отдельно', 'Фильтры по стране, каналу, статусу бота', 'Экспорт и поиск по имени/username/id'],
    image: { src: '/marketing/clients.png', alt: 'Список клиентов в MWTRACK', address: 'mw-track.com/projects/…/clients' },
  },
  {
    eyebrow: 'Атрибуция',
    title: 'От клика до депозита — без пробелов',
    description:
      'Карточка клиента хранит полный путь: пиксель, рекламный кабинет, кампания, объявление, площадка, UTM и fbclid. Видно, какой байер и какая связка реально принесли депозит.',
    bullets: ['Пересылка событий в Facebook CAPI и TikTok Events API', 'Ручная и автоматическая регистрация депозитов', 'GDPR-удаление по запросу клиента'],
    image: { src: '/marketing/client-detail.png', alt: 'Карточка клиента с источником трафика', address: 'mw-track.com/projects/…/clients' },
    reverse: true,
  },
  {
    eyebrow: 'Команда',
    title: 'Права по каждому проекту, а не общий доступ на всё',
    description:
      'Байер видит только свои проекты, оператор — только своих клиентов. Статистика по каждому рекламщику и сравнение проектов — сразу видно, кто и что приносит.',
    bullets: ['Роли Owner / Admin / Buyer / Operator', 'Приглашение по ссылке — без почтовых рассылок', 'Выручка и клиенты в разрезе по байеру'],
    image: { src: '/marketing/team.png', alt: 'Команда и статистика по байерам', address: 'mw-track.com/team' },
  },
];

const MORE_ITEMS = [
  'Боты и сценарии диалогов',
  'Лендинги, домены и A/B-тесты',
  'Рассылки в несколько вариантов',
  'Личный аккаунт вместо бота',
  'Умное время отправки по CTR',
  'Крипто-оплата подписки',
];

export function MarketingHome() {
  return (
    <div className="min-h-screen bg-[#F3F5F8] dark:bg-[#0F1620] text-[#131A24] dark:text-[#E9EDF3]">
      <header className="max-w-6xl mx-auto px-6 sm:px-8 py-6 flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="text-sm font-medium px-4 py-2 rounded-lg text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors"
          >
            Войти
          </Link>
          <Link
            href="/register"
            className="text-sm font-medium px-4 py-2 rounded-lg bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] hover:opacity-90 transition-opacity"
          >
            Регистрация
          </Link>
        </div>
      </header>

      <main>
        {/* Хиро — реальный скрин воронки вместо абстрактной иллюстрации, с лёгким наклоном и
            цветным пятном за рамкой (не идеально прямоугольная сетка). */}
        <section className="max-w-6xl mx-auto px-6 sm:px-8 pt-8 pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-12 items-center">
            <div>
              <span className="text-xs font-mono uppercase tracking-widest text-[#1F4E9C] dark:text-[#7BA9EE]">
                CRM для медиабайеров
              </span>
              <h1 className="mt-4 text-4xl sm:text-[2.75rem] font-bold tracking-tight text-balance leading-[1.1]">
                Весь трафик и диалоги Telegram — в одном месте
              </h1>
              <p className="mt-5 text-lg text-[#5F6B7A] dark:text-[#92A0AF] text-balance">
                Боты, личные аккаунты, лендинги со своим трекингом и рассылки — вместо
                разрозненных таблиц и десятка сторонних сервисов.
              </p>
              <div className="mt-8 flex items-center gap-3 flex-wrap">
                <Link
                  href="/register"
                  className="inline-flex items-center gap-2 text-sm font-medium px-6 py-3 rounded-lg bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] hover:opacity-90 transition-opacity"
                >
                  Начать бесплатно <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/login"
                  className="text-sm font-medium px-6 py-3 rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm hover:opacity-90 transition-opacity"
                >
                  У меня уже есть аккаунт
                </Link>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-8 bg-gradient-to-br from-[#1F4E9C]/10 to-transparent dark:from-[#7BA9EE]/10 rounded-[2rem] -z-10" />
              <div className="rotate-[-1.2deg]">
                <BrowserFrame src="/marketing/hero-funnel.png" alt="Воронка конверсий проекта в MWTRACK" address="mw-track.com/projects/…" />
              </div>
            </div>
          </div>
        </section>

        {/* Чередующиеся блоки текст/скриншот — вместо сетки одинаковых карточек. */}
        <div className="max-w-6xl mx-auto px-6 sm:px-8 space-y-24 pb-24">
          {SECTIONS.map((s) => {
            const text = (
              <div className={s.reverse ? 'lg:pl-4' : 'lg:pr-4'}>
                <span className="text-xs font-mono uppercase tracking-widest text-[#1F4E9C] dark:text-[#7BA9EE]">{s.eyebrow}</span>
                <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-balance">{s.title}</h2>
                <p className="mt-4 text-[#5F6B7A] dark:text-[#92A0AF] text-balance">{s.description}</p>
                <ul className="mt-5 space-y-2">
                  {s.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-1.5 w-1 h-1 rounded-full bg-[#1F4E9C] dark:bg-[#7BA9EE] shrink-0" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
            const image = <BrowserFrame src={s.image.src} alt={s.image.alt} address={s.image.address} />;
            return (
              <section key={s.title} className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
                {s.reverse ? (
                  <>
                    {image}
                    {text}
                  </>
                ) : (
                  <>
                    {text}
                    {image}
                  </>
                )}
              </section>
            );
          })}
        </div>

        {/* Компактный список остального — не отдельная секция с иконками-квадратиками, просто
            строка тегов под основными блоками. */}
        <section className="max-w-6xl mx-auto px-6 sm:px-8 pb-24">
          <div className="rounded-2xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-6 sm:p-8">
            <h3 className="text-sm font-semibold text-[#5F6B7A] dark:text-[#92A0AF]">И это ещё не всё</h3>
            <div className="mt-4 flex flex-wrap gap-2">
              {MORE_ITEMS.map((item) => (
                <span
                  key={item}
                  className="text-sm px-3 py-1.5 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] text-[#131A24] dark:text-[#E9EDF3]"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 sm:px-8 pb-24 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Готовы попробовать?</h2>
          <p className="mt-2 text-[#5F6B7A] dark:text-[#92A0AF]">Триал бесплатно, банковская карта не нужна.</p>
          <Link
            href="/register"
            className="mt-6 inline-flex items-center gap-2 text-sm font-medium px-6 py-3 rounded-lg bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] hover:opacity-90 transition-opacity"
          >
            Создать аккаунт <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>

      <footer className="max-w-6xl mx-auto px-6 sm:px-8 py-8 text-sm text-[#5F6B7A] dark:text-[#92A0AF] flex items-center justify-between">
        <Logo />
        <span>© {new Date().getFullYear()} MWTRACK</span>
      </footer>
    </div>
  );
}
