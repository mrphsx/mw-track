'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { toClassicPath, toStudioPath } from '@/lib/design-toggle';

// Единый переключатель "классика / Studio (бета)" в один клик (запрос пользователя 2026-07-30:
// "добавь переключатель в header, где можно будет в один клик переключать дизайн на бета
// studio") — используется и в классической шапке (@/components/layout/header.tsx, owner-only),
// и в шапке самой Studio (dashboard/studio/layout.tsx, доступ туда и так уже owner-only через
// apps/web/src/app/dashboard/layout.tsx, отдельная проверка роли здесь не нужна). Заменил
// собой прежние точечные кнопки "Новый дизайн (бета)" на главной и странице проекта (те вели на
// удалённую теперь галерею /dashboard и на удалённый вариант control-room) — один переключатель
// в шапке работает на КАЖДОЙ странице благодаря toStudioPath/toClassicPath, а не только на этих
// двух.
export function DesignModeToggle({ mode, mutedClassName = 'text-muted-foreground' }: { mode: 'classic' | 'studio'; mutedClassName?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString() ? `?${searchParams.toString()}` : '';

  return (
    <div className="flex items-center gap-1.5">
      <Sparkles className={`w-3.5 h-3.5 shrink-0 ${mutedClassName}`} />
      <span className={`text-xs font-medium ${mutedClassName}`}>Studio (бета)</span>
      <Switch
        checked={mode === 'studio'}
        onCheckedChange={(checked) => router.push(checked ? toStudioPath(pathname, search) : toClassicPath(pathname, search))}
      />
    </div>
  );
}
