'use client';

import { useAuthStore } from '@/store/auth.store';
import { Badge } from '@/components/ui/badge';
import { DesignModeToggle } from '@/components/layout/design-mode-toggle';

const PLAN_LABELS: Record<string, string> = {
  TRIAL: 'Триал',
  STARTER: 'Starter',
  GROWTH: 'Growth',
  SCALE: 'Scale',
  ENTERPRISE: 'Enterprise',
};

export function Header() {
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'OWNER' || user?.role === 'SUPER_ADMIN';

  return (
    <header className="h-14 border-b bg-card flex items-center justify-between px-6 shrink-0">
      <div className="font-medium text-sm text-foreground">{user?.company?.name}</div>
      <div className="flex items-center gap-3">
        {isOwner && <DesignModeToggle mode="classic" />}
        {user?.company?.plan && (
          <Badge variant="secondary" className="font-normal">
            {PLAN_LABELS[user.company.plan] || user.company.plan}
          </Badge>
        )}
      </div>
    </header>
  );
}
