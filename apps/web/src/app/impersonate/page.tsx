'use client';

// Приёмник кода обмена для дебаг-имперсонации из apps/admin (запрос пользователя 2026-09-24,
// "зайти в компанию по сессии овнера") — см. AuthService.startImpersonation/
// exchangeImpersonationCode и AdminCompanyService.impersonate.
//
// Намеренно ТОП-ЛЕВЕЛ страница, вне (auth)/(dashboard)/dashboard route groups — ни один из
// auth-gate layout'ов её не видит, поэтому не нужно ничего в них трогать. middleware.ts
// исключает этот путь из Studio-domain rewrite так же, как /login/register/invite.
//
// Сырой axios, не через store.login()/lib/api — здесь нет пароля, только одноразовый код, и
// ответ уже в форме {accessToken, user} (без refreshToken — см. startImpersonation: сессия
// живёт ровно 15 минут, без записи в RefreshToken, никакого доп. кода на фронте для истечения
// не нужно, обычный refreshAccessToken() просто упадёт при первом протухшем access-токене и
// штатно разлогинит через logout()). Не пишем shared cookie (setSharedRefreshCookie) — раз нет
// refreshToken, сессия и не должна тихо переползать на old.mw-track.com.
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import axios, { isAxiosError } from 'axios';
import { useAuthStore } from '@/store/auth.store';
import { API_BASE_URL } from '@/lib/api-base-url';

// useSearchParams() требует Suspense boundary при статической генерации (иначе next build
// падает на prerender этой страницы) — тот же паттерн, что уже используется на других
// search-params-страницах в этом дереве.
export default function ImpersonatePage() {
  return (
    <Suspense>
      <ImpersonateInner />
    </Suspense>
  );
}

function ImpersonateInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setError('Отсутствует код доступа');
      return;
    }

    let cancelled = false;
    axios
      .post(`${API_BASE_URL}/auth/exchange-impersonation-code`, { code })
      .then(({ data }) => {
        if (cancelled) return;
        useAuthStore.setState({ accessToken: data.accessToken, refreshToken: null, user: data.user });
        router.replace('/');
      })
      .catch((err) => {
        if (cancelled) return;
        setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Ссылка недействительна или устарела');
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FC] dark:bg-[#0F1620] px-4">
      <div className="text-center">
        {error ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : (
          <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Выполняется вход...</p>
        )}
      </div>
    </div>
  );
}
