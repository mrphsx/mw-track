import { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface StatsCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  hint?: string;
  // Красная подпись помельче (запрос пользователя 2026-07-24, карточка "Клиентов": "отписались...
  // минус и число отписавшихся") — отдельно от обычного серого hint выше, для метрик со знаком
  // "минус" (что-то ушедшее/потерянное), а не нейтрального уточнения.
  dangerHint?: string;
  // Studio (запрос пользователя 2026-08-03: "карточки просмотров, кликов итд в темной теме
  // серые") — тот же паттерн, что уже применён для LandingContentCard/LandingCard: обычный
  // shadcn `<Card>` в тёмной теме красится в `--card` (плейсхолдер, не настоящий Studio-синий
  // #171F2B, см. память dark_theme_rollout). Когда передан containerClassName — рендерится
  // div с этим классом вместо <Card>, поведение остальных потребителей не меняется.
  containerClassName?: string;
  mutedClassName?: string;
}

export function StatsCard({ label, value, icon: Icon, hint, dangerHint, containerClassName, mutedClassName }: StatsCardProps) {
  const muted = mutedClassName ?? 'text-muted-foreground';
  const body = (
    <div className="p-5 flex items-start justify-between">
      <div>
        <div className={`text-sm ${muted}`}>{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        {hint && <div className={`text-xs ${muted} mt-1`}>{hint}</div>}
        {dangerHint && <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">{dangerHint}</div>}
      </div>
      <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
        <Icon className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
      </div>
    </div>
  );

  if (containerClassName) return <div className={containerClassName}>{body}</div>;
  return <Card>{body}</Card>;
}

interface DualStatsCardItem {
  label: string;
  value: string | number;
  icon: LucideIcon;
}

// Две метрики в одной карточке (запрос пользователя 2026-07-17: "фд/рд можно в одну ячейку",
// "клиенты и клиенты активировавщие бота тоже в одну") — вместо двух отдельных StatsCard.
export function DualStatsCard({
  items,
  containerClassName,
  mutedClassName,
  dividerClassName,
}: {
  items: DualStatsCardItem[];
  containerClassName?: string;
  mutedClassName?: string;
  // divide-x/divide-border использует тот же placeholder-токен, что и bg-card — в Studio
  // нужен свой цвет разделителя, совпадающий с остальными бордерами Studio-карточек.
  dividerClassName?: string;
}) {
  const muted = mutedClassName ?? 'text-muted-foreground';
  const body = (
    <div className={`p-5 flex items-stretch justify-between ${dividerClassName ?? 'divide-x divide-border'}`}>
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`flex-1 flex items-start justify-between gap-3 ${i > 0 ? 'pl-4' : ''} ${i < items.length - 1 ? 'pr-4' : ''}`}
        >
          <div>
            <div className={`text-sm ${muted}`}>{item.label}</div>
            <div className="text-2xl font-bold mt-1">{item.value}</div>
          </div>
          <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center shrink-0">
            <item.icon className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
          </div>
        </div>
      ))}
    </div>
  );

  if (containerClassName) return <div className={containerClassName}>{body}</div>;
  return <Card>{body}</Card>;
}
