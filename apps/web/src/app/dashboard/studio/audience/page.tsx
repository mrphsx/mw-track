'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AudiencePeriodValue, computeAudiencePeriodDates, toApiPeriodParams, useAudiencePeriodQueryState } from '@/lib/use-audience-period';
import { STUDIO_CARD } from '../ui';
import { StudioAudiencePeriodPicker } from './period-picker';

interface OverlapMatrix {
  projects: { id: string; name: string }[];
  totals: Record<string, number>;
  pairs: { projectAId: string; projectBId: string; count: number }[];
}

// Studio-версия страницы пересечения аудиторий — логика 1:1 с классической, файл самодостаточен,
// полный реskin (см. комментарий там для полной истории правок 2026-07-30..2026-08-31).
function getHeatClasses(pct: number): string {
  if (pct < 10) return 'bg-green-500 dark:bg-green-600 text-white';
  if (pct < 20) return 'bg-yellow-400 dark:bg-yellow-500 text-slate-900';
  if (pct < 30) return 'bg-red-300 dark:bg-red-400/80 text-slate-900';
  return 'bg-red-700 dark:bg-red-800 text-white';
}

function pairHref(aId: string, bId: string, period: AudiencePeriodValue): string {
  const dates = computeAudiencePeriodDates(period);
  const params = new URLSearchParams({ period: period.period });
  if (dates.from) params.set('from', dates.from);
  if (dates.to) params.set('to', dates.to);
  return `/audience/${aId}/${bId}?${params.toString()}`;
}

export default function StudioAudiencePage() {
  // Дефолт 30d (запрос пользователя 2026-08-31: "изначально поставь чтобы было за 30 дней").
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

  const getPercent = (rowId: string, count: number): number => {
    const total = data?.totals[rowId] || 0;
    return total > 0 ? Math.round((count / total) * 100) : 0;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Пересечение аудиторий</h1>
        <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1.5">
          Подписчики, которые состоят одновременно в нескольких проектах компании — сопоставление
          по Telegram user id. Диагональ — общее число подписчиков проекта (без учёта внешних
          контактов, которые просто написали боту/аккаунту, но не подписались через воронку).
          Процент в квадрате — доля ОТ подписчиков проекта в начале строки, поэтому у одной и той
          же пары ячеек проценты слева направо и сверху вниз обычно разные. Клик по ячейке
          открывает подробное сравнение этой пары.
        </p>
      </div>

      {/* Тот же пилюльный period-picker, что на странице проекта, плюс "Всё время" (запрос
          пользователя 2026-08-31). */}
      <StudioAudiencePeriodPicker value={period} onChange={setPeriod} />

      {isLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {!isLoading && (data?.projects.length ?? 0) < 2 && (
        <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>
          Нужно минимум два проекта с идентифицированными Telegram-клиентами, чтобы увидеть
          пересечения.
        </div>
      )}

      {!isLoading && (data?.projects.length ?? 0) >= 2 && data && (
        <div className={`${STUDIO_CARD} p-4 overflow-x-auto`}>
          <table className="border-collapse">
            <thead>
              <tr>
                <th className="p-2 text-left text-sm text-[#5F6B7A] dark:text-[#92A0AF]"></th>
                {data.projects.map((p) => (
                  <th key={p.id} className="p-1.5 pb-2 text-sm font-medium align-bottom text-[#131A24] dark:text-[#E9EDF3]">
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
                  <td className="p-2 text-sm font-medium whitespace-nowrap align-middle text-[#131A24] dark:text-[#E9EDF3]">
                    {rowProject.name}
                  </td>
                  {data.projects.map((colProject) => {
                    const isDiagonal = rowProject.id === colProject.id;
                    const count = getCount(rowProject.id, colProject.id);
                    const pct = getPercent(rowProject.id, count);
                    return (
                      <td key={colProject.id} className="p-1">
                        {isDiagonal ? (
                          <div className="w-[72px] h-[72px] rounded-2xl bg-[#F3F5F8] dark:bg-white/5 flex items-center justify-center text-base font-semibold text-[#5F6B7A] dark:text-[#92A0AF]">
                            {count}
                          </div>
                        ) : (
                          <Link
                            href={pairHref(rowProject.id, colProject.id, period)}
                            className={`w-[72px] h-[72px] rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-transform hover:scale-105 ${getHeatClasses(pct)}`}
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
        </div>
      )}
    </div>
  );
}
