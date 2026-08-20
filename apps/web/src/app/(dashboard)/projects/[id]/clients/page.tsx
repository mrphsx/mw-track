'use client';

import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PeriodValue } from '@/components/shared/period-selector';
import { computePeriodDates } from '@/lib/use-period-query-state';
import { ClientsPeriodPicker } from '@/components/clients/clients-period-picker';
import {
  ClientsFilter,
  ClientsFilterState,
  readClientsFiltersFromSearchParams,
  writeClientsFiltersToSearchParams,
} from '@/components/clients/clients-filter';
import { ClientsTable, ClientRow } from '@/components/clients/clients-table';
import { ClientDetailDrawer } from '@/components/clients/client-detail-drawer';
import { useAuthStore } from '@/store/auth.store';

interface ClientsResponse {
  items: ClientRow[];
  total: number;
  page: number;
  totalPages: number;
}

// "ours" — реальные клиенты воронки (по умолчанию). "external" — холодные контакты, которые
// просто написали в личку/боту мимо нашей ссылки/лендинга (subscribedAt: null) — не влияют на
// статистику проекта, но диалог с ними по-прежнему виден здесь, отдельно (баг-репорт
// пользователя 2026-07-17: "можно таких добавить в другой какой-то список").
type ClientOrigin = 'ours' | 'external';

const PERIOD_VALUES = ['today', 'yesterday', '7d', '30d', 'custom'] as const;

// null — "Все" (запрос пользователя 2026-08-18: "изначально не будет выбран период никакой и
// показывает всех клиентов") — отдельное персистентное состояние, не просто дефолт до первого
// клика: отсутствие ?period= в URL читается как null, а не как какой-то пресет по умолчанию.
function readPeriodFromSearchParams(params: URLSearchParams): PeriodValue | null {
  const period = params.get('period');
  if (!period) return null;
  if (period === 'custom') {
    const from = params.get('from') || undefined;
    const to = params.get('to') || undefined;
    if (from && to) return { period: 'custom', from, to };
  }
  if ((PERIOD_VALUES as readonly string[]).includes(period)) return { period: period as PeriodValue['period'] };
  return null;
}

export default function ClientsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user = useAuthStore((s) => s.user);

  // Персистентность страницы/периода/происхождения/поиска/всех фильтров в URL (запрос
  // пользователя 2026-08-18: "сохраняй в пути также страницу... и все остальные фильтры так же
  // сохраняй") — читаются один раз при монтировании из searchParams, дальше живут в обычном
  // useState; один общий useEffect ниже пишет их все разом обратно в URL при любом изменении
  // (не несколько независимых router.replace — иначе гонка между period и остальными полями).
  const [origin, setOrigin] = useState<ClientOrigin>(() => (searchParams.get('origin') === 'external' ? 'external' : 'ours'));
  const [filters, setFilters] = useState<ClientsFilterState>(() => readClientsFiltersFromSearchParams(searchParams));
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [page, setPage] = useState(() => Number(searchParams.get('page')) || 1);
  const [periodValue, setPeriodValue] = useState<PeriodValue | null>(() => readPeriodFromSearchParams(searchParams));
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const periodReady = !periodValue || periodValue.period !== 'custom' || (!!periodValue.from && !!periodValue.to);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('origin', origin);
    if (search) params.set('search', search);
    if (periodValue) {
      params.set('period', periodValue.period);
      // from/to всегда конкретные даты, не только для custom (запрос пользователя 2026-08-18:
      // "ставь всегда параметры from to, а не просто today, 30d итд") — см. computePeriodDates.
      const dates = computePeriodDates(periodValue);
      if (dates.from) params.set('from', dates.from);
      if (dates.to) params.set('to', dates.to);
    }
    writeClientsFiltersToSearchParams(filters, params);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, origin, search, periodValue, filters]);

  const exportLookalike = async () => {
    const res = await api.get(`/projects/${id}/clients/export/lookalike`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lookalike_${id}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // placeholderData: keepPreviousData (запрос пользователя 2026-07-21: "надпись 'Всего' ненадолго
  // пропадает и весь фронтенд прыгает") — при смене queryKey (фильтр/страница/поиск) React Query
  // по умолчанию отдаёт data: undefined на время рефетча, пока не придёт новый ответ; с этой
  // опцией старые данные остаются на экране (и "Всего", и сама таблица) до готовности новых —
  // никакого пропадания/схлопывания layout между запросами.
  const { data } = useQuery({
    queryKey: ['clients', id, origin, filters, search, page, periodValue],
    queryFn: async () =>
      (
        await api.get<ClientsResponse>(`/projects/${id}/clients`, {
          params: {
            page,
            origin,
            channelType: filters.channelType,
            hasPurchase: filters.hasPurchase,
            hasDialogue: filters.hasDialogue,
            country: filters.country,
            minSpent: filters.minSpent,
            landingId: filters.landingId,
            buyerId: filters.buyerId,
            pixelId: filters.pixelId,
            campaignName: filters.campaignName,
            adName: filters.adName,
            adsetName: filters.adsetName,
            siteSourceName: filters.siteSourceName,
            utmSource: filters.utmSource,
            utmMedium: filters.utmMedium,
            utmCampaign: filters.utmCampaign,
            utmContent: filters.utmContent,
            adSource: filters.adSource,
            search: search || undefined,
            period: periodValue?.period,
            from: periodValue?.period === 'custom' ? periodValue.from : undefined,
            to: periodValue?.period === 'custom' ? periodValue.to : undefined,
          },
        })
      ).data,
    enabled: periodReady,
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Клиенты</h1>
          {data && <p className="text-sm text-muted-foreground">Всего: {data.total}</p>}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Имя, username, user_id..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-56"
          />
          <Button variant="outline" onClick={exportLookalike}>
            <Download className="w-4 h-4 mr-1.5" /> Экспорт
          </Button>
        </div>
      </div>

      {/* Переключатель "наши/внешние" и период — один ряд, период в правом конце (запрос
          пользователя 2026-08-18: "плашка с периодом должна быть в один ряд с switch кнопкой
          наши клиенты и внешние клиенты только в правом конце"). */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => { setOrigin('ours'); setPage(1); }}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                origin === 'ours' ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Наши клиенты
            </button>
            <button
              type="button"
              onClick={() => { setOrigin('external'); setPage(1); }}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                origin === 'external' ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Внешние контакты
            </button>
          </div>
          {origin === 'external' && (
            <p className="text-xs text-muted-foreground">
              Написали в личку/боту или вступили в канал не по нашей ссылке — не учитываются в статистике проекта.
              Дата диалога — когда мы впервые увидели сообщение, а не обязательно начало реального общения с клиентом:
              переписка могла идти и раньше.
            </p>
          )}
        </div>

        <ClientsPeriodPicker value={periodValue} onChange={(v) => { setPeriodValue(v); setPage(1); }} />
      </div>

      <ClientsFilter projectId={id} value={filters} onChange={(v) => { setFilters(v); setPage(1); }} />

      <div className="border rounded-lg bg-card">
        <ClientsTable
          projectId={id}
          clients={data?.items ?? []}
          onSelect={setSelectedClientId}
          showTrafficSource={user?.role !== 'OPERATOR'}
        />
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Назад
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {data.totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Далее
          </Button>
        </div>
      )}

      <ClientDetailDrawer projectId={id} clientId={selectedClientId} onClose={() => setSelectedClientId(null)} />
    </div>
  );
}
