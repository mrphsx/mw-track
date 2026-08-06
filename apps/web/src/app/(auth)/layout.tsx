'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

// Редизайн 2026-08-05 (запрос пользователя: "убери эту карточку для формы, добавь что-то
// красивое в наших цветах, форму можно в бок для красоты и антисимметрии") — раньше это была
// одна центрированная белая карточка (bg-card rounded-2xl shadow) на сером фоне, у всех трёх
// страниц (login/register/invite) один и тот же шаблон. Теперь общий "шелл" — брендовая панель
// (градиент в цветах Studio + реальный скрин продукта, см. AuthBrandPanel ниже) занимает часть
// экрана, форма — в оставшейся колонке, без своей рамки/тени вообще (фон панели/страницы уже
// даёт контраст). Сторона панели чередуется между /login и /register/invite (panelOnRight) —
// сама эта асимметрия между двумя связанными страницами и есть "антисимметрия", о которой просили.
function AuthBrandPanel() {
  return (
    <div className="relative hidden lg:flex lg:w-[44%] xl:w-[42%] shrink-0 overflow-hidden bg-gradient-to-br from-[#132D5E] via-[#1F4E9C] to-[#3568C4]">
      <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute bottom-0 right-0 w-[28rem] h-[28rem] rounded-full bg-[#7BA9EE]/25 blur-3xl" />

      {/* Обычный flex-поток (не absolute) — лого сверху, текст по центру оставшегося
          пространства, скрин снизу с отрицательными полями/наклоном для эффекта "вылезает за
          край" — без риска наложения на текст, который был при absolute-позиционировании. */}
      <div className="relative z-10 flex flex-col h-full w-full p-10 xl:p-14">
        <span className="text-xl font-bold tracking-tight text-white shrink-0">
          MW<span className="text-[#9CC1F5]">TRACK</span>
        </span>

        <div className="flex-1 flex flex-col justify-center max-w-sm min-h-0">
          <p className="text-2xl xl:text-[1.75rem] font-bold text-white leading-snug text-balance">
            Весь трафик и диалоги Telegram — под рукой, в реальном времени.
          </p>
          <p className="mt-3 text-sm text-white/70">
            Боты, личные аккаунты, лендинги и рассылки — в одной CRM для медиабайеров.
          </p>
        </div>

        {/* Скрин реальной воронки — тот же кроп, что на главной, чуть под углом и вылезает за
            правый край панели (отрицательный margin, обрезается overflow-hidden контейнера
            снаружи) — асимметрия/жизнь вместо ровной центрированной картинки. */}
        <div className="shrink-0 self-end w-[22rem] xl:w-[26rem] -mb-10 -mr-14 xl:-mr-16 rotate-[-4deg]">
          <div className="rounded-xl border border-white/10 shadow-2xl shadow-black/30 overflow-hidden bg-white">
            <div className="flex items-center gap-1.5 px-3 py-2 bg-[#EEF1F5]">
              <span className="w-2 h-2 rounded-full bg-[#E5645A]" />
              <span className="w-2 h-2 rounded-full bg-[#E8B23D]" />
              <span className="w-2 h-2 rounded-full bg-[#5FB77E]" />
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/marketing/hero-funnel.png" alt="" className="w-full h-auto block" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { accessToken, hydrated } = useAuthStore();

  useEffect(() => {
    if (hydrated && accessToken) router.replace('/');
  }, [hydrated, accessToken, router]);

  const panelOnRight = pathname === '/register';

  return (
    <div className="min-h-screen flex bg-white dark:bg-[#0F1620]">
      {!panelOnRight && <AuthBrandPanel />}
      <div className="flex-1 flex items-center justify-center px-6 py-16 sm:px-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
      {panelOnRight && <AuthBrandPanel />}
    </div>
  );
}
