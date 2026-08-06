'use client';

import { useAuthStore } from '@/store/auth.store';
import { Badge } from '@/components/ui/badge';

const PLAN_LABELS: Record<string, string> = {
  TRIAL: 'Триал',
  STARTER: 'Starter',
  GROWTH: 'Growth',
  SCALE: 'Scale',
  ENTERPRISE: 'Enterprise',
};

// Классика теперь живёт исключительно на old.mw-track.com (запрос пользователя 2026-07-30:
// "старый дизайн перенеси на поддомен... из хэдера убери уже переключатель дизайнов") —
// переключатель "классика/Studio" убран отсюда: смена дизайна теперь означает переход на
// другой домен (ссылка есть в StudioSidebar), а не JS-роутинг внутри одного приложения.
export function Header() {
  const user = useAuthStore((s) => s.user);

  return (
    <header className="h-14 border-b bg-card flex items-center justify-between px-6 shrink-0">
      <div className="font-medium text-sm text-foreground">{user?.company?.name}</div>
      <div className="flex items-center gap-3">
        {user?.company?.plan && (
          <Badge variant="secondary" className="font-normal">
            {PLAN_LABELS[user.company.plan] || user.company.plan}
          </Badge>
        )}
      </div>
    </header>
  );
}
