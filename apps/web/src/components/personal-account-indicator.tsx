'use client';

import { useRouter } from 'next/navigation';
import { UserCheck, UserX } from 'lucide-react';
import { cn } from '@/lib/utils';

// Иконка статуса личного Telegram-аккаунта (запрос пользователя 2026-07-27: "добавь иконку
// когда личный аккаунт не привязан, как мы сделали для привязанного, и при клике переносить
// на страницу привязки") — используется и в карточке проекта (/projects), и в общем заголовке
// (/projects/[id]/layout.tsx). Показывать только для Telegram-каналов — вызывающий сам решает,
// рендерить компонент или нет (WhatsApp/Instagram не поддерживают личный аккаунт вообще).
// preventDefault+stopPropagation — обе карточки, где это используется, сами являются
// кликабельной ссылкой на страницу проекта, эта иконка должна вести в другое место.
export function PersonalAccountIndicator({
  projectId,
  connected,
  size = 'sm',
}: {
  projectId: string;
  connected: boolean;
  size?: 'sm' | 'md';
}) {
  const router = useRouter();
  const Icon = connected ? UserCheck : UserX;
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <button
      type="button"
      title={connected ? 'Личный аккаунт Telegram подключён' : 'Личный аккаунт Telegram не подключён — нажмите, чтобы привязать'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        router.push(`/projects/${projectId}/settings?tab=personal`);
      }}
      className={cn(
        'inline-flex shrink-0 bg-transparent border-0 p-0 cursor-pointer transition-colors',
        connected
          ? 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300'
          : 'text-amber-500 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300',
      )}
    >
      <Icon className={iconSize} />
    </button>
  );
}
