'use client';

// Сравнительный блок A/B/n (Фаза 3.2, расширено с пары до произвольного числа вариантов) — та
// же форма конверсии, что и обычные StatsCard (клики/просмотры, подписки/клики), просто рядом
// для всех участников группы сразу — по одной строке на каждого. Вынесено из
// /landings/[landingId]/page.tsx (запрос пользователя 2026-07-23: "для груп лэндингов тоже
// нужна статистика") — теперь используется и там (лендинг внутри теста), и на новой странице
// статистики самой группы (/landings/groups/[groupId]).
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LandingStatus, LandingType } from '@/lib/landings';

export interface LandingVariantStats {
  landing: {
    id: string;
    name: string;
    type: LandingType;
    status: LandingStatus;
    // Автор (запрос пользователя 2026-08-03) — null у лендингов без резолвящегося создателя.
    createdBy: { id: string; firstName: string; lastName: string | null } | null;
  };
  subscribers: { total: number; active: number; unsubscribed: number };
  funnel: { pageViews: number; leads: number; subscribes: number };
  dialogues: { total: number; dailyDialogues: { date: string; count: number }[] };
  dailySubscribers: { date: string; count: number }[];
  attachment: { domain: string; path: string } | null;
}

export interface AbTestMemberStats extends LandingVariantStats {
  weight: number;
}

export function AbTestComparisonCard({ members }: { members: AbTestMemberStats[] }) {
  const row = (label: string, member: AbTestMemberStats) => {
    const leadRate = member.funnel.pageViews > 0 ? Math.round((member.funnel.leads / member.funnel.pageViews) * 100) : null;
    const subscribeRate = member.funnel.leads > 0 ? Math.round((member.funnel.subscribes / member.funnel.leads) * 100) : null;
    return (
      <div key={member.landing.id} className="border rounded-md p-3 space-y-2">
        <p className="font-medium truncate">
          {label} ({member.weight}%): {member.landing.name}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div>
            <p className="text-muted-foreground">Просмотров</p>
            <p className="font-medium">{member.funnel.pageViews}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Кликов</p>
            <p className="font-medium">
              {member.funnel.leads} {leadRate !== null && <span className="text-muted-foreground">({leadRate}%)</span>}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Подписчиков</p>
            <p className="font-medium">
              {member.subscribers.total} {subscribeRate !== null && <span className="text-muted-foreground">({subscribeRate}%)</span>}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Диалогов</p>
            <p className="font-medium">{member.dialogues.total}</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">A/B/n-тест ({members.length} вариантов)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{members.map((m, i) => row(String.fromCharCode(65 + i), m))}</CardContent>
    </Card>
  );
}
