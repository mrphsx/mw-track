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

export function Header() {
  const user = useAuthStore((s) => s.user);

  return (
    <header className="h-14 border-b bg-white flex items-center justify-between px-6 shrink-0">
      <div className="font-medium text-sm text-gray-700">{user?.company?.name}</div>
      {user?.company?.plan && (
        <Badge variant="secondary" className="font-normal">
          {PLAN_LABELS[user.company.plan] || user.company.plan}
        </Badge>
      )}
    </header>
  );
}
