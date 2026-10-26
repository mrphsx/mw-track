'use client';

// Мини-апп CRM в Telegram (2026-10-26): открывается кнопкой «Открыть CRM» в боте оповещений
// компании (?b=<id бота>). Telegram передаёт подписанные данные о том, кто открыл, — сервер
// проверяет подпись и выдаёт обычную сессию сотрудника, к которому привязан этот Telegram.
// Топ-левел страница вне auth-гейтов, как /impersonate; middleware не переписывает её на Studio.
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isAxiosError } from 'axios';
import { useTheme } from 'next-themes';
import { useAuthStore } from '@/store/auth.store';

interface TelegramWebApp {
  initData: string;
  colorScheme?: 'light' | 'dark';
  ready: () => void;
  expand: () => void;
}

function loadTelegramScript(): Promise<TelegramWebApp | null> {
  const w = window as unknown as { Telegram?: { WebApp?: TelegramWebApp } };
  if (w.Telegram?.WebApp) return Promise.resolve(w.Telegram.WebApp);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.onload = () => resolve(w.Telegram?.WebApp ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

export default function TelegramMiniAppPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setTheme } = useTheme();
  const loginWithTelegram = useAuthStore((s) => s.loginWithTelegram);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const botId = searchParams.get('b');
      const app = await loadTelegramScript();
      if (cancelled) return;
      if (!app || !app.initData || !botId) {
        setError('Откройте CRM из Telegram — кнопкой «Открыть CRM» в боте оповещений вашей компании.');
        return;
      }
      app.ready();
      app.expand();
      if (app.colorScheme) setTheme(app.colorScheme);
      try {
        await loginWithTelegram(botId, app.initData);
        // Кнопка проекта в боте ведёт сразу в него (?next=/projects/<id>) — только свои пути.
        const next = searchParams.get('next');
        if (!cancelled) router.replace(next && /^\/projects\/[A-Za-z0-9]+$/.test(next) ? next : '/');
      } catch (err) {
        if (!cancelled) setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось войти');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FC] dark:bg-[#0F1620] px-6">
      <div className="max-w-sm text-center">
        {error ? (
          <p className="text-sm text-[#131A24] dark:text-[#E9EDF3]">{error}</p>
        ) : (
          <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Выполняется вход…</p>
        )}
      </div>
    </div>
  );
}
