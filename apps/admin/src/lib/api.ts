import axios from 'axios';
import { useAuthStore } from '@/store/auth.store';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export const api = axios.create({ baseURL: API_BASE_URL });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Тот же паттерн общей refresh-очереди, что и в apps/web/src/lib/api.ts — несколько
// параллельных 401 не должны запускать несколько refresh (refresh-токен одноразовый).
let refreshPromise: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (!original || error.response?.status !== 401 || original._retried || original.url === '/auth/refresh') {
      return Promise.reject(error);
    }
    original._retried = true;

    try {
      if (!refreshPromise) {
        refreshPromise = useAuthStore
          .getState()
          .refreshAccessToken()
          .finally(() => {
            refreshPromise = null;
          });
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
