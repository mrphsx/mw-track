'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useQuery } from '@tanstack/react-query';
import { Bell, Moon, Sun, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { StudioSidebar } from '@/components/layout/studio-sidebar';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const PLAN_LABELS: Record<string, string> = {
  TRIAL: 'Триал',
  STARTER: 'Starter',
  GROWTH: 'Growth',
  SCALE: 'Scale',
  ENTERPRISE: 'Enterprise',
};

interface ProjectSummary {
  id: string;
  name: string;
  channel: { type: string; isActive: boolean; tgPersonalLastError: string | null } | null;
}

// Шелл дизайна "Studio" — единственный оставшийся вариант нового дизайна и, с 2026-07-30,
// основной дизайн приложения для всех ролей на основном домене (mw-track.com); классика
// переехала на old.mw-track.com отдельным доменом (см. apps/web/src/middleware.ts). Доступ
// проверяет общий apps/web/src/app/dashboard/layout.tsx выше по дереву (теперь просто
// авторизация, без ограничения по роли) — здесь только сайдбар/шапка этого дизайна, в тёплой
// палитре (см. studio-sidebar.tsx).
//
// Переключатель дизайнов в шапке (DesignModeToggle) убран тем же днём ("из хэдера убери уже
// переключатель дизайнов"), а сама ссылка на классику (была в сайдбаре, StudioSidebar,
// "Старый дизайн") убрана позже, 2026-08-31, по прямому запросу пользователя — old.mw-track.com
// остаётся живым доменом (код/данные не тронуты), просто без единой ссылки на него из UI.
//
// Правки раунда 2026-07-29 ("перенеси смену темы наверх и сделай как свитч", "добавь красиво
// баланс так же сверху, иконку оповещений и подписку тоже"):
// - Тема — раньше выпадающее меню (light/dark/system) внизу сайдбара, теперь бинарный Switch
//   в шапке (StudioSidebar лишился этого блока целиком, не дублируем — "system" как отдельный
//   пункт ушёл, Switch по своей природе бинарный, resolvedTheme решает начальное положение).
// - Уведомления — реальные данные (истекающая подписка + отключённые боты проектов, не
//   выдуманные), оформлены под тёплую палитру Studio.
// - Баланс/план — пилюли в духе остальных элементов Studio (rounded-full, белая карточка с
//   мягкой тенью), а не отдельная плотная строка-реестр, как в Ledger.
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === 'dark';

  // Класс-маркер на <html> (запрос пользователя 2026-08-18: "все попапы и дропдауны
  // черно-серого цвета, поправь все") — Dialog/Select/DropdownMenu/Drawer рендерят контент через
  // Portal в document.body, вне дерева этого layout'а, так что класс, отличающий Studio от
  // классики для CSS-переопределения токенов (globals.css, .studio.dark), обязан жить на общем
  // предке <html>, а не на каком-то вложенном div — только так его подхватят и портальные попапы.
  // Ставится/убирается в эффекте, а не статичной JSX-разметкой — <html> общий для обоих деревьев
  // (Studio и классика, домены на одном Next.js-процессе), брендировать его вложенным layout'ом
  // напрямую нельзя.
  useEffect(() => {
    document.documentElement.classList.add('studio');
    return () => document.documentElement.classList.remove('studio');
  }, []);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });
  const inactiveProjects = (projects ?? []).filter((p) => p.channel && !p.channel.isActive);
  // Запрос пользователя 2026-08-06: "проверять раз в некоторое время... уведомление и изменение
  // статуса" — TelegramPersonalHealthCron (раз в 30 минут) сам чистит tgSessionEncrypted при
  // обнаружении отозванной сессии и заодно проставляет tgPersonalLastError (в отличие от ручного
  // отключения из настроек, которое его не трогает) — этим полем и отличаем "было подключено, но
  // Telegram отозвал сессию" от "личный аккаунт вообще не подключён" (для большинства проектов).
  const disconnectedPersonalAccounts = (projects ?? []).filter((p) => p.channel?.tgPersonalLastError);

  const daysLeft = user?.company?.planExpiresAt
    ? Math.ceil((new Date(user.company.planExpiresAt).getTime() - Date.now()) / 86_400_000)
    : null;
  const expiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;

  // "Бот" неверно для WEBSITE (у сайта нет бота вообще, запрос пользователя 2026-09-03: "Но это
  // же не бот, сделай правильую надпись") — родовое "Канал" подходит любому типу.
  const notifications: string[] = [
    ...(expiringSoon ? [`Подписка истекает через ${daysLeft} дн.`] : []),
    ...inactiveProjects.map((p) => `${p.channel?.type === 'WEBSITE' ? 'Канал' : 'Бот'} проекта «${p.name}» отключён`),
    ...disconnectedPersonalAccounts.map((p) => `Личный аккаунт проекта «${p.name}» отключён — сессия отозвана Telegram, переподключите`),
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-[#F3F5F8] dark:bg-[#0F1620]">
      <StudioSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 flex items-center justify-between px-8 shrink-0 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[10px] font-medium uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE] shrink-0">
              Beta
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Объединено в одну пилюлю (запрос пользователя 2026-07-30: "таблетка плана меньше
                чем остальные, лучше добавь все в одну таблету, план, баланс, уведомления") —
                раньше баланс/план/колокол были тремя визуально разными элементами (разный
                размер текста, разная форма — прямоугольная пилюля vs круглая кнопка), теперь
                один общий контур с внутренними разделителями, общий text-sm/паддинг на все три
                секции. На узких экранах вся пилюля скрыта целиком (не по частям — раздельное
                скрытие внутри одного divide-x выглядело бы криво), вместо неё отдельная голая
                кнопка-колокол, чтобы уведомления оставались доступны и на мобильном. */}
            <div className="hidden sm:flex items-center rounded-full bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-sm overflow-hidden">
              {user?.company && (
                <div className="flex items-center gap-1.5 px-3 py-1.5">
                  <Wallet className="w-3.5 h-3.5 text-[#1F7A6C] dark:text-[#6FCBBA] shrink-0" />
                  <span className="font-mono tabular-nums font-semibold text-[#131A24] dark:text-[#E9EDF3]">
                    ${Number(user.company.balance).toFixed(2)}
                  </span>
                </div>
              )}

              {user?.company?.plan && (
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 font-medium border-l border-[#DCE1E8] dark:border-white/10 ${
                    expiringSoon ? 'text-red-600 dark:text-red-400' : 'text-[#5F6B7A] dark:text-[#92A0AF]'
                  }`}
                >
                  {PLAN_LABELS[user.company.plan] || user.company.plan}
                  {daysLeft !== null && <span className="opacity-70">· {daysLeft} дн.</span>}
                </div>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger className="relative flex items-center px-3 py-1.5 border-l border-[#DCE1E8] dark:border-white/10 text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                  <Bell className="w-4 h-4" />
                  {notifications.length > 0 && (
                    <span className="absolute top-1 right-1.5 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">
                      {notifications.length}
                    </span>
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {notifications.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Всё в порядке</div>}
                  {notifications.map((n, i) => (
                    <DropdownMenuItem key={i} className="text-sm">
                      {n}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Мобильный fallback — та же кнопка-колокол, только не в пилюле, скрыта от sm и выше. */}
            <DropdownMenu>
              <DropdownMenuTrigger className="relative sm:hidden w-9 h-9 flex items-center justify-center rounded-full bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors">
                <Bell className="w-4 h-4" />
                {notifications.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {notifications.length}
                  </span>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {notifications.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Всё в порядке</div>}
                {notifications.map((n, i) => (
                  <DropdownMenuItem key={i} className="text-sm">
                    {n}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center gap-1.5 pl-1 pr-1">
              <Sun className="w-3.5 h-3.5 text-[#5F6B7A] dark:text-[#92A0AF] shrink-0" />
              <Switch checked={isDark} onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')} />
              <Moon className="w-3.5 h-3.5 text-[#5F6B7A] dark:text-[#92A0AF] shrink-0" />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-8 pb-10">{children}</main>
      </div>
    </div>
  );
}
