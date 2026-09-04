'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { AudiencePeriodSelector } from '@/components/shared/audience-period-selector';
import { AudiencePeriodValue, computeAudiencePeriodDates, toApiPeriodParams, useAudiencePeriodQueryState } from '@/lib/use-audience-period';

interface OverlapMatrix {
  projects: { id: string; name: string }[];
  totals: Record<string, number>;
  pairs: { projectAId: string; projectBId: string; count: number }[];
}

// Цветовая шкала по проценту пересечения (запрос пользователя 2026-08-31: "до 10% зелёный,
// 20 - жёлтый, 30 - светло красный, 50 - тёмно красный") — 4 диапазона, верхняя граница
// открытая (30%+ включает и 50%, и всё что больше — "50" в запросе просто ориентир внутри
// самой тёмной зоны, не отдельный 5й порог).
function getHeatClasses(pct: number): string {
  if (pct < 10) return 'bg-green-500 dark:bg-green-600 text-white';
  if (pct < 20) return 'bg-yellow-400 dark:bg-yellow-500 text-slate-900';
  if (pct < 30) return 'bg-red-300 dark:bg-red-400/80 text-slate-900';
  return 'bg-red-700 dark:bg-red-800 text-white';
}

// Ссылка на страницу пары с уже применённым текущим периодом (запрос пользователя 2026-08-31:
// период есть и на странице пересечений, и на странице конкретной пары) — те же query-параметры,
// что usePeriodQueryState уже пишет в адресную строку этой самой страницы.
function pairHref(aId: string, bId: string, period: AudiencePeriodValue): string {
  // computeAudiencePeriodDates, не period.from/to напрямую — тот же хук хранит from/to в своём
  // React-state только для 'custom' (именованные пресеты пишут даты сразу в URL строки, но не
  // возвращают их обратно в сам объект period) — без пересчёта ссылка на пару могла остаться
  // без дат для пресетов (функционально не критично — бэкенд сам пересчитывает окно по имени
  // периода, — но ломает чистоту шаримой ссылки).
  const dates = computeAudiencePeriodDates(period);
  const params = new URLSearchParams({ period: period.period });
  if (dates.from) params.set('from', dates.from);
  if (dates.to) params.set('to', dates.to);
  return `/audience/${aId}/${bId}?${params.toString()}`;
}

export default function AudiencePage() {
  // Дефолт 30d (запрос пользователя 2026-08-31: "изначально поставь чтобы было за 30 дней") —
  // раньше было 'today', на что часто выпадало пусто, пока пользователь сам не переключал период.
  const [period, setPeriod] = useAudiencePeriodQueryState('30d');
  const periodParams = toApiPeriodParams(period);

  const { data, isLoading } = useQuery({
    queryKey: ['audience-overlap', periodParams],
    queryFn: async () => (await api.get<OverlapMatrix>('/audience/overlap', { params: periodParams })).data,
  });

  const getCount = (aId: string, bId: string): number => {
    if (!data) return 0;
    if (aId === bId) return data.totals[aId] || 0;
    const pair = data.pairs.find(
      (p) => (p.projectAId === aId && p.projectBId === bId) || (p.projectAId === bId && p.projectBId === aId),
    );
    return pair?.count || 0;
  };

  // % от общего числа подписчиков СТРОКИ (rowId), не колонки — матрица по сырым числам
  // симметрична (пересечение A∩B = B∩A), а вот проценты — нет, у каждой строки свой знаменатель.
  const getPercent = (rowId: string, count: number): number => {
    const total = data?.totals[rowId] || 0;
    return total > 0 ? Math.round((count / total) * 100) : 0;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Пересечение аудиторий</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Подписчики, которые состоят одновременно в нескольких проектах компании — сопоставление
          по Telegram user id. Диагональ — общее число подписчиков проекта (без учёта внешних
          контактов, которые просто написали боту/аккаунту, но не подписались через воронку).
          Процент в квадрате — доля ОТ подписчиков проекта в начале строки, поэтому у одной и той
          же пары ячеек проценты слева направо и сверху вниз обычно разные. Клик по ячейке
          открывает подробное сравнение этой пары.
        </p>
      </div>

      <AudiencePeriodSelector value={period} onChange={setPeriod} />

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}

      {!isLoading && (data?.projects.length ?? 0) < 2 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Нужно минимум два проекта с идентифицированными Telegram-клиентами, чтобы увидеть
            пересечения.
          </CardContent>
        </Card>
      )}

      {!isLoading && (data?.projects.length ?? 0) >= 2 && data && (
        <Card>
          <CardContent className="p-4 overflow-x-auto">
            <table className="border-collapse">
              <thead>
                <tr>
                  <th className="p-2 text-left text-sm text-muted-foreground"></th>
                  {/* Вертикальные заголовки — каждая колонка теперь занимает место только под
                      сам квадрат, а не под всё название проекта, помещается заметно больше
                      проектов. maxHeight+ellipsis — потолок высоты шапки, полное имя в title. */}
                  {data.projects.map((p) => (
                    <th key={p.id} className="p-1.5 pb-2 text-sm font-medium align-bottom">
                      <div
                        className="whitespace-nowrap overflow-hidden text-ellipsis mx-auto"
                        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: 140 }}
                        title={p.name}
                      >
                        {p.name}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.projects.map((rowProject) => (
                  <tr key={rowProject.id}>
                    <td className="p-2 text-sm font-medium whitespace-nowrap align-middle">{rowProject.name}</td>
                    {data.projects.map((colProject) => {
                      const isDiagonal = rowProject.id === colProject.id;
                      const count = getCount(rowProject.id, colProject.id);
                      const pct = getPercent(rowProject.id, count);
                      // Запрос пользователя 2026-08-31: "сделай ячейку квадратной и большой, все
                      // одного размера, округлой по нашему дизайну" + покрасить по проценту —
                      // раньше была маленькая пилюля переменной ширины (зависела от того,
                      // сколько цифр в числе), теперь фиксированный квадрат 72×72, цвет —
                      // теплокарта по проценту (только у недиагональных ячеек — у диагонали
                      // процент не имеет смысла, всегда 100% от самого себя).
                      return (
                        <td key={colProject.id} className="p-1">
                          {isDiagonal ? (
                            <div className="w-[72px] h-[72px] rounded-xl bg-muted flex items-center justify-center text-base font-semibold text-muted-foreground">
                              {count}
                            </div>
                          ) : (
                            <Link
                              href={pairHref(rowProject.id, colProject.id, period)}
                              className={`w-[72px] h-[72px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-transform hover:scale-105 ${getHeatClasses(pct)}`}
                            >
                              <span className="text-lg font-bold leading-none">{count}</span>
                              <span className="text-xs opacity-90 leading-none">{pct}%</span>
                            </Link>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
