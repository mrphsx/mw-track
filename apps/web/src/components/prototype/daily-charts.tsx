'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { mergeDailySeries, PrototypeProjectStats } from '@/lib/prototype-project-data';

interface DailyChartsProps {
  stats?: PrototypeProjectStats;
  periodLabel: string;
  primaryLight: string;
  primaryDark: string;
  secondaryLight: string;
  secondaryDark: string;
  cardClassName: string;
  titleClassName: string;
  legendClassName: string;
  // Опционально — переопределить вид самих вкладок (запрос пользователя 2026-07-28: "график...
  // остался тем же" — общий Tabs выглядел одинаково во всех 3 прототипах). Без них — дефолтный
  // вид shared Tabs-компонента (Control Room/Ledger).
  tabsListClassName?: string;
  tabsTriggerClassName?: string;
}

// Графики по дням (запрос пользователя 2026-07-28: "нет графиков", были в оригинале как
// вкладки LineChart на recharts) — общий презентационный компонент на все 3 прототипа, чтобы
// не тройить одну и ту же разметку recharts. Цвет линий берётся из next-themes напрямую (не
// CSS-токен) — SVG stroke не понимает Tailwind dark:-варианты, поэтому у каждого прототипа
// свой цвет на каждую тему передаётся явно (тот же принцип, что и остальной teal/amber/emerald
// акцент в этих дизайнах).
export function DailyCharts({
  stats,
  periodLabel,
  primaryLight,
  primaryDark,
  secondaryLight,
  secondaryDark,
  cardClassName,
  titleClassName,
  legendClassName,
  tabsListClassName,
  tabsTriggerClassName,
}: DailyChartsProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === 'dark';
  const primary = isDark ? primaryDark : primaryLight;
  const secondary = isDark ? secondaryDark : secondaryLight;
  const gridColor = isDark ? '#ffffff' : '#000000';

  return (
    <Tabs defaultValue="subscribers">
      <TabsList className={tabsListClassName}>
        <TabsTrigger value="subscribers" className={tabsTriggerClassName}>Подписчики</TabsTrigger>
        <TabsTrigger value="views-clicks" className={tabsTriggerClassName}>Просмотры и клики</TabsTrigger>
        <TabsTrigger value="dialogues" className={tabsTriggerClassName}>Диалоги</TabsTrigger>
        <TabsTrigger value="deposits" className={tabsTriggerClassName}>Депозиты (ФД/РД)</TabsTrigger>
        <TabsTrigger value="revenue" className={tabsTriggerClassName}>Выручка</TabsTrigger>
      </TabsList>

      <TabsContent value="subscribers" className="mt-4">
        <div className={cardClassName}>
          <h3 className={titleClassName}>Подписчики {periodLabel}</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={stats?.dailySubscribers ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={0.1} />
              <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} stroke={gridColor} strokeOpacity={0.4} />
              <YAxis fontSize={12} allowDecimals={false} stroke={gridColor} strokeOpacity={0.4} />
              <Tooltip labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')} />
              <Line type="monotone" dataKey="count" stroke={primary} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </TabsContent>

      <TabsContent value="views-clicks" className="mt-4">
        <div className={cardClassName}>
          <h3 className={titleClassName}>Просмотры и клики {periodLabel}</h3>
          <Legend className={legendClassName} items={[{ color: primary, label: 'Просмотры' }, { color: secondary, label: 'Клики' }]} />
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={mergeDailySeries(stats?.dailyPageViews, stats?.dailyLeads)}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={0.1} />
              <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} stroke={gridColor} strokeOpacity={0.4} />
              <YAxis fontSize={12} allowDecimals={false} stroke={gridColor} strokeOpacity={0.4} />
              <Tooltip labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')} />
              <Line type="monotone" dataKey="a" name="Просмотры" stroke={primary} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="b" name="Клики" stroke={secondary} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </TabsContent>

      <TabsContent value="dialogues" className="mt-4">
        <div className={cardClassName}>
          <h3 className={titleClassName}>Диалоги {periodLabel}</h3>
          <Legend className={legendClassName} items={[{ color: primary, label: 'Все диалоги' }, { color: secondary, label: 'Из нашей CRM' }]} />
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={stats?.dailyDialogues ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={0.1} />
              <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} stroke={gridColor} strokeOpacity={0.4} />
              <YAxis fontSize={12} allowDecimals={false} stroke={gridColor} strokeOpacity={0.4} />
              <Tooltip labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')} />
              <Line type="monotone" dataKey="count" name="Все диалоги" stroke={primary} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="crmCount" name="Из нашей CRM" stroke={secondary} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </TabsContent>

      <TabsContent value="deposits" className="mt-4">
        <div className={cardClassName}>
          <h3 className={titleClassName}>Депозиты (ФД/РД) {periodLabel}</h3>
          <Legend className={legendClassName} items={[{ color: primary, label: 'ФД' }, { color: secondary, label: 'РД' }]} />
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={stats?.dailyDeposits ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={0.1} />
              <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} stroke={gridColor} strokeOpacity={0.4} />
              <YAxis fontSize={12} allowDecimals={false} stroke={gridColor} strokeOpacity={0.4} />
              <Tooltip labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')} />
              <Line type="monotone" dataKey="fdCount" name="ФД" stroke={primary} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="rdCount" name="РД" stroke={secondary} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </TabsContent>

      <TabsContent value="revenue" className="mt-4">
        <div className={cardClassName}>
          <h3 className={titleClassName}>Выручка по дням</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={stats?.dailyRevenue ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={0.1} />
              <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} stroke={gridColor} strokeOpacity={0.4} />
              <YAxis fontSize={12} tickFormatter={(v) => `$${v}`} stroke={gridColor} strokeOpacity={0.4} />
              <Tooltip
                labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')}
                formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Выручка']}
              />
              <Line type="monotone" dataKey="amount" stroke={primary} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function Legend({ items, className }: { items: { color: string; label: string }[]; className: string }) {
  return (
    <div className={className}>
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
