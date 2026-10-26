'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// Цвет инициалов стабилен для собеседника (по peerId) — как в Telegram: так людей без фото
// проще различать в длинном списке.
const INITIALS_HUES = [
  'bg-[#1F4E9C]/12 text-[#1F4E9C] dark:bg-[#7BA9EE]/15 dark:text-[#7BA9EE]',
  'bg-[#1F7A6C]/12 text-[#1F7A6C] dark:bg-[#6FCBBA]/15 dark:text-[#6FCBBA]',
  'bg-[#6B3E63]/12 text-[#6B3E63] dark:bg-[#D19BC4]/15 dark:text-[#D19BC4]',
  'bg-[#A8783C]/12 text-[#A8783C] dark:bg-[#E0B378]/15 dark:text-[#E0B378]',
  'bg-[#52606B]/12 text-[#52606B] dark:bg-[#A6B4C0]/15 dark:text-[#A6B4C0]',
];

function hueFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return INITIALS_HUES[Math.abs(hash) % INITIALS_HUES.length];
}

export function ChatAvatar({
  projectId,
  clientId,
  hasAvatar,
  seed,
  name,
  size = 'md',
}: {
  projectId: string;
  clientId: string | null;
  hasAvatar: boolean;
  seed: string;
  name: string;
  size?: 'md' | 'lg';
}) {
  // Тот же ключ кэша, что у ClientAvatar, — фото клиента грузится один раз на всё приложение.
  const { data: url } = useQuery({
    queryKey: ['client-avatar', clientId],
    queryFn: async () =>
      URL.createObjectURL((await api.get(`/projects/${projectId}/clients/${clientId}/avatar`, { responseType: 'blob' })).data as Blob),
    enabled: hasAvatar && !!clientId,
    staleTime: Infinity,
    retry: false,
  });

  const box = size === 'lg' ? 'w-11 h-11 text-base' : 'w-10 h-10 text-sm';
  if (url) return <img src={url} alt="" className={cn(box, 'rounded-full object-cover shrink-0')} />;

  const initials = name
    .replace(/^@/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  return (
    <div className={cn(box, 'rounded-full flex items-center justify-center font-semibold shrink-0', hueFor(seed))}>
      {initials || '?'}
    </div>
  );
}
