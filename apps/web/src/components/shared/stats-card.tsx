import { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface StatsCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  hint?: string;
  // Красная подпись помельче (запрос пользователя 2026-07-24, карточка "Клиентов": "отписались...
  // минус и число отписавшихся") — отдельно от обычного серого hint выше, для метрик со знаком
  // "минус" (что-то ушедшее/потерянное), а не нейтрального уточнения.
  dangerHint?: string;
}

export function StatsCard({ label, value, icon: Icon, hint, dangerHint }: StatsCardProps) {
  return (
    <Card>
      <CardContent className="p-5 flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="text-2xl font-bold mt-1">{value}</div>
          {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
          {dangerHint && <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">{dangerHint}</div>}
        </div>
        <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
          <Icon className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
        </div>
      </CardContent>
    </Card>
  );
}

interface DualStatsCardItem {
  label: string;
  value: string | number;
  icon: LucideIcon;
}

// Две метрики в одной карточке (запрос пользователя 2026-07-17: "фд/рд можно в одну ячейку",
// "клиенты и клиенты активировавщие бота тоже в одну") — вместо двух отдельных StatsCard.
export function DualStatsCard({ items }: { items: DualStatsCardItem[] }) {
  return (
    <Card>
      <CardContent className="p-5 flex items-stretch justify-between divide-x divide-border">
        {items.map((item, i) => (
          <div
            key={item.label}
            className={`flex-1 flex items-start justify-between gap-3 ${i > 0 ? 'pl-4' : ''} ${i < items.length - 1 ? 'pr-4' : ''}`}
          >
            <div>
              <div className="text-sm text-muted-foreground">{item.label}</div>
              <div className="text-2xl font-bold mt-1">{item.value}</div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center shrink-0">
              <item.icon className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
