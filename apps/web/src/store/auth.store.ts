import axios from 'axios';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_BASE_URL, api } from '@/lib/api';

export interface Company {
  id: string;
  name: string;
  slug: string;
  plan: 'TRIAL' | 'STARTER' | 'GROWTH' | 'SCALE' | 'ENTERPRISE';
  planExpiresAt: string | null;
  balance: string;
  maxProjects: number;
  maxClients: number;
  maxPushesPerMonth: number;
  currentProjects: number;
  currentClients: number;
  pushesThisMonth: number;
}

export interface User {
  id: string;
  companyId: string;
  email: string;
  firstName: string;
  lastName?: string | null;
  role: 'SUPER_ADMIN' | 'OWNER' | 'ADMIN' | 'BUYER' | 'OPERATOR';
  avatarUrl?: string | null;
  company?: Company;
  // Гранулярные права, per-project (запрос пользователя 2026-07-28) — {} для elevated ролей
  // (OWNER/ADMIN/SUPER_ADMIN, см. @/lib/permissions.ts hasPermission — они не проверяются по
  // списку вообще), реальная карта projectId -> Permission[] для BUYER/OPERATOR. Приходит из
  // /auth/login|refresh|me. Только UI-подсказка — реальная защита всегда на бэкенде.
  permissionsByProject: Record<string, string[]>;
}

interface RegisterPayload {
  companyName: string;
  email: string;
  password: string;
  firstName: string;
}

interface AcceptInvitePayload {
  email: string;
  password: string;
  firstName: string;
  lastName?: string;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  acceptInvite: (token: string, payload: AcceptInvitePayload) => Promise<void>;
  logout: () => void;
  refreshAccessToken: () => Promise<string>;
  setHydrated: () => void;
}

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

      register: async (payload) => {
        const { data } = await api.post('/auth/register', payload);
        set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      },

      acceptInvite: async (token, payload) => {
        const { data } = await api.post(`/team-invites/${token}/accept`, payload);
        set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      },

      logout: () => {
        const refreshToken = get().refreshToken;
        // fire-and-forget — выходим из UI сразу, не дожидаясь бэкенда
        if (refreshToken) api.post('/auth/logout', { refreshToken }).catch(() => {});
        set({ accessToken: null, refreshToken: null, user: null });
      },

      refreshAccessToken: async () => {
        const refreshToken = get().refreshToken;
        if (!refreshToken) throw new Error('Нет refresh token');
        // Прямой axios, не через api.ts — иначе свой же response-интерцептор перехватит
        // 401 истёкшего refresh-токена и рекурсивно попробует обновиться им же.
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
        set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
        return data.accessToken as string;
      },

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'trafficcrm-auth',
      partialize: (s) => ({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);
