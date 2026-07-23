import axios from 'axios';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_BASE_URL, api } from '@/lib/api';

export interface User {
  id: string;
  companyId: string;
  email: string;
  firstName: string;
  lastName?: string | null;
  role: 'SUPER_ADMIN' | 'OWNER' | 'ADMIN' | 'BUYER' | 'OPERATOR';
  permissions: string[];
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshAccessToken: () => Promise<string>;
  setHydrated: () => void;
}

// Своё отдельное Next.js-приложение (Фаза 4.3A, запрос пользователя 2026-07-19: "я бы сделал
// её вообще отдельно") — свой ключ localStorage ('trafficcrm-admin-auth', не
// 'trafficcrm-auth'), чтобы не коллизировать с apps/web, даже если оба когда-нибудь окажутся
// на одном origin в деве. Логин идёт через тот же бэкенд-эндпоинт (POST /auth/login) — API
// один на оба приложения, разделения на бэкенде нет и не нужно (реальная граница —
// @Roles(SUPER_ADMIN) на /admin/* роутах, не то, какое фронтенд-приложение стучится).
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      hydrated: false,

      login: async (email, password) => {
        const { data } = await api.post('/auth/login', { email, password });
        set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      },

      logout: () => {
        const refreshToken = get().refreshToken;
        if (refreshToken) api.post('/auth/logout', { refreshToken }).catch(() => {});
        set({ accessToken: null, refreshToken: null, user: null });
      },

      refreshAccessToken: async () => {
        const refreshToken = get().refreshToken;
        if (!refreshToken) throw new Error('Нет refresh token');
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
        set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
        return data.accessToken as string;
      },

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'trafficcrm-admin-auth',
      partialize: (s) => ({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);
