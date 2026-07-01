import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SubscriptionBannerProps {
  plan: string;
  planExpiresAt: string | null;
}

export function SubscriptionBanner({ plan, planExpiresAt }: SubscriptionBannerProps) {
  if (!planExpiresAt) return null;

  const daysLeft = Math.ceil((new Date(planExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (plan !== 'TRIAL' && daysLeft > 3) return null;

  const expired = daysLeft < 0;

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
        <p className="text-sm text-amber-800">
          {expired
            ? 'Срок подписки истёк — функции ограничены до автопродления или сброса до TRIAL.'
            : plan === 'TRIAL'
              ? `Триал заканчивается через ${daysLeft} дн.`
              : `Автопродление через ${daysLeft} дн. — проверьте баланс.`}
        </p>
      </div>
      <Button size="sm" nativeButton={false} render={<Link href="/billing">Оплатить</Link>} />
    </div>
  );
}
