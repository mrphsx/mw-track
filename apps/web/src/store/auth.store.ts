import axios from 'axios';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
// НЕ импортируется из '@/lib/api' — тот файл импортирует useAuthStore ИЗ ЭТОГО модуля, и раньше
// это был безобидный цикл (см. api-base-url.ts за полным разбором, там же объясняется, почему он
// перестал быть безобидным). API_BASE_URL живёт в отдельном файле без импортов именно чтобы
// разорвать цикл; login/register/acceptInvite ниже используют сырой axios вместо обёрнутого
// `api`-инстанса по той же причине, что и уже существовавший refreshAccessToken.
import { API_BASE_URL } from '@/lib/api-base-url';

// Кросс-доменный "мостик" для SSO между mw-track.com (Studio) и old.mw-track.com (классика) —
// запрос пользователя 2026-07-30: "при переходе на старый дизайн опять просит логин". Токены
// в остальном по-прежнему живут в localStorage через zustand persist ниже (Bearer-заголовок,
// не cookie — см. api.ts) — localStorage строго по origin, поэтому old.mw-track.com никогда не
// видел localStorage с mw-track.com, сколько бы раз пользователь ни логинился. Единственное,
// что реально нужно расшарить между доменами — refreshToken (маленький, живёт 30 дней, им можно
// получить свежий accessToken+user на ЛЮБОМ домене через /auth/refresh) — кладём его ТАКЖЕ в
// cookie с Domain=.mw-track.com (виден обоим поддоменам), никогда не accessToken/user целиком
// (не хотим раздувать cookie, отправляемую с каждым запросом, картой permissionsByProject).
const SHARED_COOKIE_NAME = 'mw_refresh';
const SHARED_COOKIE_DOMAIN = '.mw-track.com';
const SHARED_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 дней — совпадает со сроком жизни refreshToken (см. AuthService.refresh)

function setSharedRefreshCookie(token: string | null) {
  if (typeof document === 'undefined') return;
  if (token) {
    document.cookie = `${SHARED_COOKIE_NAME}=${encodeURIComponent(token)}; Domain=${SHARED_COOKIE_DOMAIN}; Path=/; Max-Age=${SHARED_COOKIE_MAX_AGE}; Secure; SameSite=Lax`;
  } else {
    document.cookie = `${SHARED_COOKIE_NAME}=; Domain=${SHARED_COOKIE_DOMAIN}; Path=/; Max-Age=0; Secure; SameSite=Lax`;
  }
}

function getSharedRefreshCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${SHARED_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  plan: 'TRIAL' | 'STARTER' | 'GROWTH' | 'SCALE' | 'ENTERPRISE';
  planExpiresAt: string | null;
  balance: string;
  maxProjects: number;
  maxClients: number;
  maxPushesPerDay: number;
  currentProjects: number;
  currentClients: number;
  pushesToday: number;
}

export interface User {
  id: string;
  companyId: string;
  email: string;
  firstName: string;
  lastName?: string | null;
  role: 'SUPER_ADMIN' | 'OWNER' | 'ADMIN' | 'BUYER' | 'OPERATOR' | 'OPERATOR_ADMIN';
  avatarUrl?: string | null;
  // Короткий код баера в трекинг-ссылке (запрос пользователя 2026-08-20, вместо полного id в
  // скрытом параметре z=) — сгенерирован на бэкенде при создании пользователя, может быть null
  // только для очень старых записей до этой правки (buildTrackedLink тогда просто подставляет
  // обычный id, ссылка чуть длиннее, но рабочая).
  buyerShortCode?: string | null;
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
  bootstrapFromSharedCookie: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      hydrated: false,

      login: async (email, password) => {
        const { data } = await axios.post(`${API_BASE_URL}/auth/login`, { email, password });
        set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
        setSharedRefreshCookie(data.refreshToken);
      },

      register: async (payload) => {
        const { data } = await axios.post(`${API_BASE_URL}/auth/register`, payload);
        set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
        setSharedRefreshCookie(data.refreshToken);
      },

      acceptInvite: async (token, payload) => {
        const { data } = await axios.post(`${API_BASE_URL}/team-invites/${token}/accept`, payload);
        set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
        setSharedRefreshCookie(data.refreshToken);
      },

      logout: () => {
        const refreshToken = get().refreshToken;
        // fire-and-forget — выходим из UI сразу, не дожидаясь бэкенда
        if (refreshToken) axios.post(`${API_BASE_URL}/auth/logout`, { refreshToken }).catch(() => {});
        set({ accessToken: null, refreshToken: null, user: null });
        setSharedRefreshCookie(null);
      },

      refreshAccessToken: async () => {
        const refreshToken = get().refreshToken;
        if (!refreshToken) throw new Error('Нет refresh token');
        // Прямой axios, не через api.ts — иначе свой же response-интерцептор перехватит
        // 401 истёкшего refresh-токена и рекурсивно попробует обновиться им же.
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
        set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
        // refreshToken одноразовый (ротация, см. AuthService.refresh) — общую cookie нужно
        // обновлять при КАЖДОМ рефреше, иначе на другом домене останется уже отозванный токен.
        setSharedRefreshCookie(data.refreshToken);
        return data.accessToken as string;
      },

      setHydrated: () => set({ hydrated: true }),

      // Вызывается один раз сразу после того, как localStorage этого origin'а восстановился
      // (см. onRehydrateStorage ниже) — если тут своей сессии нет, но есть общая cookie с
      // refreshToken (её мог оставить логин на ДРУГОМ поддомене), пробуем поднять сессию по
      // ней, без похода на /login. Невалидный/просроченный токен просто тихо чистит cookie —
      // это не ошибка пользователя, а нормальный "давно не заходили ни туда, ни туда" случай.
      bootstrapFromSharedCookie: async () => {
        if (get().accessToken) return;
        const shared = getSharedRefreshCookie();
        if (!shared) return;
        try {
          const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken: shared });
          set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
          setSharedRefreshCookie(data.refreshToken);
        } catch {
          setSharedRefreshCookie(null);
        }
      },
    }),
    {
      name: 'trafficcrm-auth',
      partialize: (s) => ({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user }),
      // hydrated специально НЕ ставится сразу — все гейты (layout.tsx auth-проверок) ждут
      // hydrated:true, чтобы решить "логина нет, на /login". Если ставить его синхронно тут же,
      // они успели бы редиректнуть ДО того, как асинхронный bootstrapFromSharedCookie (сетевой
      // запрос) вообще успел бы попробовать поднять сессию по общей cookie — гонка, из-за
      // которой первый заход на другой поддомен всё равно мигнул бы логином. hydrated=true
      // выставляется только после того, как попытка (успешная или нет) завершилась.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.accessToken) {
          // Бэкфилл общей cookie для УЖЕ существующей сессии (запрос пользователя 2026-07-30,
          // 2-й заход: "всё ещё просит логин при переходе на old") — cookie пишется в login/
          // register/refreshAccessToken, но сессия, начатая ДО того, как это появилось (или
          // просто давно живущая без пересечения с реальным /auth/refresh — access token живёт
          // 15 минут, но если вкладка не простаивала достаточно долго, ре-фреш мог ни разу не
          // случиться), никогда не создавала cookie вообще. Пишем/обновляем её при каждой
          // успешной гидратации, а не только в момент логина/рефреша — тогда достаточно один раз
          // открыть mw-track.com после деплоя, и other-домен подхватит сессию сразу.
          setSharedRefreshCookie(state.refreshToken);
          state.setHydrated();
        } else {
          state.bootstrapFromSharedCookie().finally(() => state.setHydrated());
        }
      },
    },
  ),
);
