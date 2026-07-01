# 12 — Frontend: Все страницы и компоненты

## Задача для Claude Code
Реализуй все страницы дашборда на Next.js 14 с App Router.

---

## Страница входа и регистрации

```tsx
// apps/web/src/app/(auth)/login/page.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuthStore();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      router.push('/');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow p-8">
        <div className="text-center mb-6">
          <div className="text-3xl font-bold text-blue-600 mb-1">TrafficCRM</div>
          <p className="text-gray-500 text-sm">Вход в систему</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Пароль</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Входим...' : 'Войти'}
          </button>
          <p className="text-center text-sm text-gray-500">
            Нет аккаунта? <a href="/register" className="text-blue-600 hover:underline">Зарегистрироваться</a>
          </p>
        </form>
      </div>
    </div>
  );
}
```

---

## Главная страница — Overview

```tsx
// apps/web/src/app/(dashboard)/page.tsx
// Показывает:
// 1. SubscriptionBanner (если триал или скоро истекает)
// 2. Карточки статистики: Клиенты, Проекты, Подписки, Активных ботов
// 3. Список последних проектов (RecentProjects)
// 4. Quick actions: Создать проект, Создать рассылку
```

---

## Страницы проектов

```tsx
// apps/web/src/app/(dashboard)/projects/page.tsx
// Сетка карточек проектов
// Каждая карточка: название, статус, каналы (иконки), кол-во клиентов, кол-во пушей
// Кнопка "+ Новый проект"

// apps/web/src/app/(dashboard)/projects/new/page.tsx
// Форма:
// - Название проекта (required)
// - Описание (optional)
// Пиксели сюда НЕ входят — проект не привязан к платформе, пиксели добавляются
// после создания в Настройках (таб "Пиксели"), любое количество, любых платформ.
// После создания — redirect на /projects/:id

// apps/web/src/app/(dashboard)/projects/[id]/page.tsx
// Project Overview:
// - Header: название, статусы каналов, кнопки "Рассылка" / "Настройки"
// - Stats cards: Клиентов, Активных, Подписки, Конверсия
// - График подписчиков (последние 30 дней, LineChart)
// - Воронка конверсий (PageView → Lead → Subscribe → Purchase)
// - Список каналов с health статусом
// - Последние 5 клиентов
```

---

## Project Settings — все вкладки

```tsx
// apps/web/src/app/(dashboard)/projects/[id]/settings/page.tsx

// Таб 1: Основные
// - Название, описание
// - Кнопка Сохранить

// Таб 2: Каналы
// - Список привязанных каналов
// - Кнопка "Добавить канал" — выбор типа (Telegram / WhatsApp / Instagram)
// - Для Telegram: ввод Bot Token + инструкция как создать бота
// - Для WhatsApp: ввод Phone Number ID + Access Token
// - Статус каждого канала (активен/ошибка)

// Таб 3: Пиксели
// Проект не привязан к одной платформе — список пикселей любых платформ и в любом
// количестве (несколько FB-аккаунтов, FB+TikTok разом и т.д.), каждое событие уходит
// во все активные сразу:
// - Список: платформа (бейдж) + название + статус (активен/отключён) + удалить
// - Кнопка "Добавить пиксель" — выбор платформы (Facebook/TikTok), название
//   (опционально), Pixel ID, Access Token, Test Event Code (только Facebook)
// Кнопки "Проверить соединение"/"Отправить тестовое событие" не реализованы —
// под них нет backend-эндпоинта ни в одной фазе чек-листа.

// Таб 4: Интеграция (внешний лендинг)
// - Public Token (readonly) + кнопка копировать
// - Secret Key (скрыт, кнопка "Показать") + кнопка копировать
// - Кнопка "Перегенерировать ключи" (с подтверждением!)
// - Поле "Разрешённые домены" (CORS)
// - Готовый код для вставки (HTML snippet)
// - Пример для Node.js SDK

// Таб 5: Команда (OWNER/ADMIN only)
// - Список рекламщиков с доступом к проекту
// - Кнопка добавить / удалить доступ

// Таб 6: Опасная зона
// - Кнопка "Архивировать проект" (с подтверждением)
```

---

## Страница клиентов

```tsx
// apps/web/src/app/(dashboard)/projects/[id]/clients/page.tsx

// Layout:
// ┌─────────────────────────────────────────────────────┐
// │ Клиенты          [Поиск...]      [Фильтры ▼] [Экспорт] │
// │ Всего: 12,450 | Активных: 8,230                      │
// ├─────────────────────────────────────────────────────┤
// │ [Панель фильтров - collapsible]                      │
// │  Канал: [Все][TG][WA][IG]  Покупки: [Все][Да][Нет] │
// │  Страна: [dropdown]  Потратил: [от___] [до___]      │
// │  Подписан: [с даты] [по дату]                       │
// ├─────────────────────────────────────────────────────┤
// │ Таблица:                                             │
// │ Аватар | Имя        | Канал | Страна | Подписан     │
// │ 👤     | Ivan (@iv) |  TG   |  RU    | 12 янв       │
// │  ...                                                 │
// ├─────────────────────────────────────────────────────┤
// │ Пагинация: < 1 2 3 ... 249 >                        │
// └─────────────────────────────────────────────────────┘

// При клике на строку — открывается ClientDetailDrawer справа
```

---

## Client Detail Drawer

```tsx
// components/clients/client-detail-drawer.tsx
// Drawer (боковая панель) с полной информацией:

// Секция 1: Профиль
// - Аватар (если есть) + имя + username
// - Иконка канала (Telegram/WhatsApp/etc)
// - Флаг страны + город
// - Дата регистрации, последняя активность
// - Статус: ✅ Активен / 🚫 Заблокировал бота / ❌ Отписался

// Секция 2: Источник трафика
// - Платформа: 🔵 Facebook / ⚫ TikTok / Органика
// - UTM Campaign, UTM Source
// - fbclid (сокращённый)

// Секция 3: Финансы
// - Всего потрачено: $250.00
// - Кол-во покупок: 3
// - Средний чек: $83.33
// - Кнопка "+ Добавить покупку"

// Секция 4: История покупок
// - Список: дата, сумма, источник (вручную / бот / webhook)

// Footer:
// - Кнопка "Удалить (GDPR)" — мягкое удаление с подтверждением
```

---

## Страница пушей

```tsx
// apps/web/src/app/(dashboard)/projects/[id]/pushes/page.tsx

// Список рассылок:
// Статус | Название | Дата | Аудитория | Отправлено | Ошибки
// SENT    Акция Jan   12 янв  4,891       4,712       179
// DRAFT   Новинки     —       —           —           —
// SENDING Февраль     Сейчас  3,200       1,450/3,200  12

// Клик на строку — детали рассылки

// apps/web/src/app/(dashboard)/projects/[id]/pushes/new/page.tsx
// Мастер в 3 шага (см. основной файл 11)
```

---

## Push Content Step — детали

```tsx
// components/pushes/push-content-step.tsx

// Левая колонка — редактор:
// - Input: Название рассылки (внутреннее)
// - Textarea: Текст сообщения (поддержка HTML тегов для Telegram)
//   Счётчик: 234 / 4096
//   Быстрые теги: [B] [I] [U] [Code]
// - Загрузка медиа: drag-and-drop или кнопка
//   Поддерживаемые форматы: jpg, png, gif, mp4
// - Кнопки (до 3):
//   [Текст кнопки 1] [URL кнопки 1] [✕]
//   [+ Добавить кнопку]

// Правая колонка — Preview:
// Имитация интерфейса Telegram:
// ┌─────────────────────────────┐
// │ 📢 Название канала           │
// ├─────────────────────────────┤
// │ [Фото если есть]            │
// │                             │
// │ Текст сообщения...          │
// │                             │
// │ [Кнопка 1]                  │
// │ [Кнопка 2]                  │
// │                          12:34 │
// └─────────────────────────────┘
```

---

## Push Audience Step — детали

```tsx
// components/pushes/push-audience-step.tsx

// Фильтры:
// Канал: [✓ Telegram] [✓ WhatsApp] [✓ Instagram]
// Покупки: (•) Все ○ Только с покупками ○ Только без покупок
// Страны: [dropdown мультиселект]
// Потратил от: [___] USD
// Подписан с: [date] по [date]
// Не активен (дней): [___]+

// Счётчик аудитории (обновляется при изменении фильтра с debounce):
// ┌────────────────────────────────┐
// │ 🔥 По фильтру:    5,234       │
// │ ✅ Доступны:      4,891 (93%) │
// │ 🚫 Недоступны:      343  (7%) │
// └────────────────────────────────┘
// "Недоступны" = заблокировали бота
// Spinner пока идут расчёты
```

---

## Страница доменов

```tsx
// apps/web/src/app/(dashboard)/domains/page.tsx

// Таблица доменов:
// Домен | Статус | SSL | Лендинг | Действия

// Статус:
// 🟡 PENDING - добавлен, нужна верификация
// 🔵 VERIFYING - проверяем DNS
// 🟢 ACTIVE - работает
// 🔴 ERROR - проблема с DNS

// При PENDING показывать:
// ┌─────────────────────────────────────────────────────┐
// │ ⚠️ Требуется верификация домена                     │
// │                                                     │
// │ Добавьте TXT запись в ваш DNS:                     │
// │ Имя:    _verify.yourdomain.com                     │
// │ Значение: abc123xyz789...                          │
// │ TTL:    3600                                       │
// │                                                    │
// │ [Скопировать значение]  [Проверить →]             │
// └─────────────────────────────────────────────────────┘

// Кнопка "Добавить домен" — modal с полем ввода домена
```

**✅ Реализовано (2026-06-28), одно осознанное отличие от мокапа выше:** TXT-запись подтверждает
только владение доменом, но не то, что трафик реально идёт на наш сервер — поэтому в инструкцию
добавлена вторая строка с A-записью (`SERVER_PUBLIC_IP`) рядом с TXT. Кнопка "Проверить" одним
действием проверяет TXT и пытается выпустить SSL через Certbot — если A-запись не настроена,
Certbot HTTP-01 challenge не пройдёт, и это станет видимым `lastCheckError`, отдельной проверки
A-записи не потребовалось. Реальный файл: `apps/web/src/app/(dashboard)/domains/page.tsx`.

---

## Страница лендингов — ✅ РЕАЛИЗОВАНО (Фаза 2, шаг 2.3, 2026-06-28)

Не было в исходном мокапе вообще — нет ни одного упоминания UI для лендингов кроме строки
`{ href: '/landings', ... }` в sidebar (см. выше, не реализовано как глобальная страница).
Шаг 2.3 явно требовал "UI: drag-and-drop загрузка ZIP", но к моменту его реализации страницы
для управления лендингами не существовало вообще — построена с нуля.

Реальный файл: `apps/web/src/app/(dashboard)/projects/[id]/landings/page.tsx`, доступ — кнопка
"Лендинги" на `/projects/[id]` (между "Рассылка" и "Настройки").

- Таблица: Название | Тип (Шаблон/Кастомный/Внешний) | Статус (Черновик/Опубликован/Архив) | Действия
  (предпросмотр / перезалить ZIP — только для CUSTOM / опубликовать·снять с публикации / удалить).
- Модалка "Создать из шаблона" — название, выбор шаблона (minimal/gradient/dark), название канала,
  текст кнопки (упрощённая форма — не все 9 полей `templateData`, остальное правится через
  `PATCH /landings/:id`, отдельной формы редактирования в рамках 2.3 не строилось).
- Модалка "Загрузить ZIP" — настоящая drag-and-drop зона (`onDragOver`/`onDrop`, не просто
  `<input type=file>`), плюс клик для выбора файла. Используется в двух режимах: создание нового
  CUSTOM-лендинга (`POST /projects/:id/landings/custom`, multipart с полем `name`) и перезаливка
  ZIP в существующий (`POST /landings/:id/upload`).
- Предпросмотр — `GET /landings/:id/preview` требует JWT (не `@Public()`), поэтому открыть его
  напрямую в новой вкладке (`<a href>`/`window.open(url)`) не сработало бы — заголовок
  `Authorization` не попал бы в запрос браузера при прямой навигации. Вместо этого: запрос через
  `api.get` (с токеном), оборачивание ответа в `Blob`, `window.open(URL.createObjectURL(blob))` —
  тот же приём, что уже использовался для CSV-экспорта на странице клиентов.

**Что проверено живым тестом:** полный сценарий в headless-браузере (Playwright) — регистрация →
создание проекта → переход на страницу лендингов → открытие модалки загрузки → выбор реального
ZIP через `input[type=file]` → загрузка → строка появилась в таблице (`Кастомный`/`Черновик`) →
"Опубликовать" → статус сменился на "Опубликован" → клик на иконку предпросмотра открыл новую
вкладку с `blob:` URL, содержащую реальный HTML загруженного лендинга. Консоль браузера — без
единой ошибки на всём сценарии. Drag-and-drop (`onDragOver`/`onDrop`) не симулировался отдельно
(сложно воспроизвести нативный drag через автоматизацию), проверен только путь "клик → выбор файла".

---

## Страница настроек аккаунта

```tsx
// apps/web/src/app/(dashboard)/settings/page.tsx

// Таб 1: Профиль
// - Имя, фамилия, email
// - Смена пароля

// Таб 2: Компания (OWNER only)
// - Название компании, slug
// - Загрузка логотипа

// Таб 3: Команда (OWNER/ADMIN)
// - Список сотрудников: имя, email, роль, последний вход
// - Кнопка "Пригласить сотрудника"
// - Изменить роль / деактивировать

// Таб 4: История платежей
// - Таблица: дата, план, сумма, статус, txHash
```

---

## Sidebar компонент

```tsx
// components/layout/sidebar.tsx
'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { 
  LayoutDashboard, FolderOpen, Users, Globe, 
  Layout, CreditCard, Settings, ChevronDown,
  Zap, UserCog
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';

const navItems = [
  { href: '/', label: 'Обзор', icon: LayoutDashboard },
  { href: '/projects', label: 'Проекты', icon: FolderOpen },
  { href: '/domains', label: 'Домены', icon: Globe },
  // Лендинги — реализовано (2026-06-28) как per-project страница /projects/[id]/landings,
  // не глобальный /landings из этого мокапа: лендинг принадлежит ровно одному проекту
  // (Landing.projectId not null), та же логика, что у /projects/[id]/pushes. Доступ —
  // кнопка "Лендинги" на странице проекта, не отдельный пункт верхнего sidebar.
  { href: '/billing', label: 'Подписка', icon: CreditCard },
  { href: '/settings', label: 'Настройки', icon: Settings },
];

const adminItems = [
  { href: '/team', label: 'Команда', icon: UserCog },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuthStore();

  return (
    <aside className="w-60 border-r bg-white flex flex-col h-screen">
      {/* Logo */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg">TrafficCRM</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map(item => (
          <Link key={item.href} href={item.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
              ${pathname === item.href || pathname.startsWith(item.href + '/')
                ? 'bg-blue-50 text-blue-600 font-medium'
                : 'text-gray-600 hover:bg-gray-50'}`}>
            <item.icon className="w-4 h-4" />
            {item.label}
          </Link>
        ))}

        {['OWNER', 'ADMIN'].includes(user?.role) && (
          <>
            <div className="pt-2 pb-1 px-3 text-xs font-medium text-gray-400 uppercase">Управление</div>
            {adminItems.map(item => (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
                  ${pathname.startsWith(item.href)
                    ? 'bg-blue-50 text-blue-600 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'}`}>
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            ))}
          </>
        )}
      </nav>

      {/* User */}
      <div className="p-3 border-t">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-medium text-sm">
            {user?.firstName?.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{user?.firstName}</div>
            <div className="text-xs text-gray-400 truncate">{user?.role}</div>
          </div>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </div>
      </div>
    </aside>
  );
}
```

---

## React Query Setup

```tsx
// apps/web/src/app/providers.tsx
'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,      // 30 сек
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools />}
    </QueryClientProvider>
  );
}
```

---

## npm зависимости для frontend

```bash
cd apps/web
npm install @tanstack/react-query @tanstack/react-query-devtools
npm install axios zustand
npm install react-hook-form @hookform/resolvers zod
npm install recharts
npm install lucide-react
npm install date-fns
npm install qrcode @types/qrcode
npm install next-themes

# shadcn компоненты
npx shadcn-ui@latest add card button input label badge progress dialog drawer tabs select textarea sheet skeleton tooltip
```
