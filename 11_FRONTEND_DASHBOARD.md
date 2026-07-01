# 11_FRONTEND_DASHBOARD.md — Next.js дашборд, роутинг, UI-инфраструктура

> Это инфраструктурный слой, на котором строятся конкретные страницы из [12_FRONTEND_PAGES.md](12_FRONTEND_PAGES.md)
> (там уже есть рабочий пример `/login`, `Sidebar`, `providers.tsx` — этот документ описывает всё
> вокруг них: структуру роутов, auth-стор, api-клиент, защиту роутов, дизайн-систему).

## App Router структура

```
apps/web/src/
  app/
    layout.tsx                 # root layout — Providers, шрифты, globals.css
    providers.tsx               # QueryClientProvider (см. 12)
    (auth)/
      layout.tsx                 # центрированный layout без сайдбара
      login/page.tsx
      register/page.tsx
    (dashboard)/
      layout.tsx                 # Sidebar + Header + AuthGuard (см. ниже)
      page.tsx                   # overview
      projects/
        page.tsx
        new/page.tsx
        [id]/
          page.tsx
          settings/page.tsx
          clients/page.tsx
          pushes/
            page.tsx
            new/page.tsx
      domains/page.tsx
      billing/page.tsx
      settings/page.tsx
      team/page.tsx
  components/
    layout/ (sidebar.tsx, header.tsx)
    clients/ (clients-table.tsx, clients-filter.tsx, client-detail-drawer.tsx)
    pushes/ (push-content-step.tsx, push-audience-step.tsx, payment-modal.tsx)
    ui/ (shadcn-генерируемые)
    shared/ (stats-card.tsx, subscription-banner.tsx)
  lib/
    api.ts
  store/
    auth.store.ts
```

Группы роутов `(auth)`/`(dashboard)` — два разных layout без общего родителя с навигацией:
`(auth)` — просто центрированная карточка (см. пример `/login` в 12_FRONTEND_PAGES.md),
`(dashboard)` — Sidebar + Header + защита по авторизации.

## Защита роутов — без middleware.ts

Токены живут в `localStorage` через `zustand/persist` (см. ниже) — Next.js `middleware.ts`
выполняется на edge-рантайме и не имеет доступа к `localStorage`, поэтому классический
паттерн "проверить cookie в middleware" здесь не работает без отдельного механизма cookie-синхронизации,
который не оправдан для MVP. Вместо этого защита — на клиенте:

```typescript
// app/(dashboard)/layout.tsx — 'use client', при монтировании:
// если в auth.store нет accessToken — router.replace('/login')
// пока идёт проверка — показываем skeleton, не контент (чтобы не мигал дашборд без авторизации)
```

Обратная защита для `(auth)/layout.tsx` — если пользователь уже залогинен и открывает `/login`,
редиректить на `/`.

## api.ts — axios + refresh-flow

```typescript
import axios from 'axios';
import { useAuthStore } from '@/store/auth.store';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1',
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Несколько параллельных запросов могут получить 401 одновременно (access token истёк
// за 15 минут жизни) — без очереди каждый запустил бы свой /auth/refresh и они бы
// гонялись за rotation (refresh-токен одноразовый, см. AuthService.refresh), второй
// запрос на refresh всегда получал бы 401 "недействителен или истёк". Поэтому все
// параллельные 401 ждут ОДИН запущенный refresh и переигрываются после него.
let refreshPromise: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status !== 401 || original._retried || original.url === '/auth/refresh') {
      return Promise.reject(error);
    }
    original._retried = true;

    try {
      if (!refreshPromise) {
        refreshPromise = useAuthStore.getState().refreshAccessToken()
          .finally(() => { refreshPromise = null; });
      }
      const newToken = await refreshPromise;
      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    } catch {
      useAuthStore.getState().logout();
      if (typeof window !== 'undefined') window.location.href = '/login';
      return Promise.reject(error);
    }
  },
);
```

## auth.store.ts — Zustand + persist

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/lib/api';

interface User {
  id: string; companyId: string; email: string;
  firstName: string; lastName?: string; role: 'SUPER_ADMIN' | 'OWNER' | 'ADMIN' | 'ADVERTISER';
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterPayload) => Promise<void>;
  logout: () => void;
  refreshAccessToken: () => Promise<string>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,

      login: async (email, password) => {
        const { data } = await api.post('/auth/login', { email, password });
        set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      },

      register: async (payload) => {
        const { data } = await api.post('/auth/register', payload);
        set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      },

      logout: () => {
        const refreshToken = get().refreshToken;
        // fire-and-forget — не блокируем выход, даже если бэкенд недоступен
        if (refreshToken) api.post('/auth/logout', { refreshToken }).catch(() => {});
        set({ accessToken: null, refreshToken: null, user: null });
      },

      refreshAccessToken: async () => {
        const refreshToken = get().refreshToken;
        if (!refreshToken) throw new Error('Нет refresh token');
        // Прямой axios, не через api.ts — иначе свой же интерцептор перехватит
        // 401 от истёкшего refresh-токена и попробует рекурсивно его же обновить
        const { data } = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
        set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
        return data.accessToken;
      },
    }),
    { name: 'trafficcrm-auth', partialize: (s) => ({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user }) },
  ),
);
```

## Дизайн-система

TailwindCSS + shadcn/ui (`npx shadcn-ui@latest init`, стиль "new-york" или "default", base color slate).
Основной акцентный цвет — синий (`blue-600`, см. пример `/login`), без отдельной кастомной палитры —
shadcn-дефолты достаточно. Шрифт — системный sans (Next.js `next/font` Inter).

## Мультипроектность

Текущий выбранный проект не хранится в URL верхнего уровня — каждая страница проекта живёт под
`/projects/[id]/...`, поэтому "текущий проект" просто следует из `params.id` на каждой странице,
отдельный стор для "активного проекта" не нужен (в отличие от классических SaaS с persistent
project switcher в хэдере — здесь это не требовалось ни одним доком).
