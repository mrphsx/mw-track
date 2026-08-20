'use client';

import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { PeriodValue } from '@/components/shared/period-selector';
import { computePeriodDates } from '@/lib/use-period-query-state';
import {
  ClientsFilter,
  ClientsFilterState,
  readClientsFiltersFromSearchParams,
  writeClientsFiltersToSearchParams,
} from '@/components/clients/clients-filter';
import { ClientRow } from '@/components/clients/clients-table';
import { ClientDetailDrawer } from '@/components/clients/client-detail-drawer';
import { StudioClientsTable } from '../../../clients-table';
import { STUDIO_CARD, StudioClientsPeriodPicker, StudioLinkButton } from '../../../ui';
import { useAuthStore } from '@/store/auth.store';

interface ClientsResponse {
  items: ClientRow[];
  total: number;
  page: number;
  totalPages: number;
}

type ClientOrigin = 'ours' | 'external';

const PERIOD_VALUES = ['today', 'yesterday', '7d', '30d', 'custom'] as const;

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

// Studio-версия страницы клиентов (запрос пользователя 2026-07-30: "готовить все остальные
// страницы") — логика 1:1 с классической (apps/web/.../(dashboard)/projects/[id]/clients/page.tsx),
// включая персистентность страницы/периода/происхождения/поиска/всех фильтров в URL (запрос
// пользователя 2026-08-18) — см. полный комментарий в classic-версии. Дизайн-правки того же дня
// ("выбор периода должен быть как на странице проекта, а тут прозрачный и других цветов",
// "карточка фильтров серо-чёрная, не подходит под наш синий", "поиск прозрачный и не подходит по
// высоте с кнопкой экспорт") — StudioClientsPeriodPicker вместо обычного PeriodSelector,
// containerClassName у ClientsFilter, Studio-стилизация поля поиска.
export default function StudioClientsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user = useAuthStore((s) => s.user);

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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Клиенты</h1>
          {data && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1">Всего: {data.total}</p>}
        </div>
        <div className="flex gap-2">
          {/* Studio-стилизация + высота ТОЧНО как у кнопки "Экспорт" (запрос пользователя
              2026-08-18, второй раз: "поиск всё ещё меньше чем кнопка экспорт, 36 и 38
              пикселей") — первая попытка (h-9=36px фиксированной высотой) не совпадала с
              StudioLinkButton, у которой высота НЕ зафиксирована h-* классом, а естественно
              вытекает из text-sm+py-2+dark:border (36px в светлой теме, 38px в тёмной — граница
              добавляется только в dark:). Фикс: убираем фиксированную высоту (h-auto вместо h-9,
              перекрывает базовый h-8 Input через twMerge) и повторяем ТОТ ЖЕ рецепт паддингов/
              рамки, что и у кнопки, вместо попытки угадать число пикселей руками. border-0 —
              явно убирает безусловный border/border-input, который есть у Input по умолчанию,
              но которого нет у StudioLinkButton в светлой теме. */}
          <Input
            placeholder="Имя, username, user_id..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-56 h-auto border-0 dark:border dark:border-white/10 px-4 py-2 text-sm rounded-lg bg-white dark:bg-[#171F2B] shadow-sm text-[#131A24] dark:text-[#E9EDF3] placeholder:text-[#92A0AF] focus-visible:ring-2 focus-visible:ring-[#1F4E9C]/40 dark:focus-visible:ring-[#7BA9EE]/40"
          />
          <StudioLinkButton icon={Download} onClick={exportLookalike}>
            Экспорт
          </StudioLinkButton>
        </div>
      </div>

      {/* Переключатель "наши/внешние" и период — один ряд, период в правом конце (запрос
          пользователя 2026-08-18). */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-1 gap-0.5">
            <button
              type="button"
              onClick={() => { setOrigin('ours'); setPage(1); }}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                origin === 'ours'
                  ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                  : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
              }`}
            >
              Наши клиенты
            </button>
            <button
              type="button"
              onClick={() => { setOrigin('external'); setPage(1); }}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                origin === 'external'
                  ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                  : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
              }`}
            >
              Внешние контакты
            </button>
          </div>
          {origin === 'external' && (
            <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
              Написали в личку/боту или вступили в канал не по нашей ссылке — не учитываются в статистике проекта.
              Дата диалога — когда мы впервые увидели сообщение, а не обязательно начало реального общения с клиентом:
              переписка могла идти и раньше.
            </p>
          )}
        </div>

        <StudioClientsPeriodPicker value={periodValue} onChange={(v) => { setPeriodValue(v); setPage(1); }} />
      </div>

      <ClientsFilter projectId={id} value={filters} onChange={(v) => { setFilters(v); setPage(1); }} containerClassName={STUDIO_CARD} />

      <StudioClientsTable
        projectId={id}
        clients={data?.items ?? []}
        onSelect={setSelectedClientId}
        showTrafficSource={user?.role !== 'OPERATOR'}
      />

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <StudioLinkButton size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Назад
          </StudioLinkButton>
          <span className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
            {page} / {data.totalPages}
          </span>
          <StudioLinkButton size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Далее
          </StudioLinkButton>
        </div>
      )}

      <ClientDetailDrawer projectId={id} clientId={selectedClientId} onClose={() => setSelectedClientId(null)} />
    </div>
  );
}
