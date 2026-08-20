'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { StudioClientsTable } from '../clients-table';
import { STUDIO_CARD, StudioClientsPeriodPicker, StudioLinkButton, StudioPill } from '../ui';
import { useAuthStore } from '@/store/auth.store';

interface ProjectSummary {
  id: string;
  name: string;
}

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

// Studio-версия жёстко урезанной страницы Operator-а — см. classic (dashboard)/my-clients для
// полного комментария о причине (запрос пользователя 2026-07-30) и о периоде/фильтрах/URL
// (запрос пользователя 2026-08-18).
export default function StudioMyClientsPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [projectId, setProjectId] = useState<string | null>(() => searchParams.get('projectId'));
  const [origin, setOrigin] = useState<ClientOrigin>(() => (searchParams.get('origin') === 'external' ? 'external' : 'ours'));
  const [filters, setFilters] = useState<ClientsFilterState>(() => readClientsFiltersFromSearchParams(searchParams));
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [page, setPage] = useState(() => Number(searchParams.get('page')) || 1);
  const [periodValue, setPeriodValue] = useState<PeriodValue | null>(() => readPeriodFromSearchParams(searchParams));
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const periodReady = !periodValue || periodValue.period !== 'custom' || (!!periodValue.from && !!periodValue.to);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });

  // Выбор проекта прямо во время рендера, не через useEffect (запрос пользователя 2026-07-31:
  // "пусть изначально будет выбран какой-то проект") — useEffect применяется уже после первого
  // коммита, из-за чего дропдаун на мгновение показывал пустой плейсхолдер вместо имени проекта.
  // projectId из URL (если валиден) побеждает первый проект в списке.
  if (!projectId && projects?.length) {
    setProjectId(projects[0].id);
  }

  useEffect(() => {
    if (!projectId) return;
    const params = new URLSearchParams();
    params.set('projectId', projectId);
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
  }, [projectId, page, origin, search, periodValue, filters]);

  const { data } = useQuery({
    queryKey: ['my-clients', projectId, origin, filters, search, page, periodValue],
    queryFn: async () =>
      (
        await api.get<ClientsResponse>(`/projects/${projectId}/clients`, {
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
    enabled: !!projectId && periodReady,
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Клиенты</h1>
          {/* Строка всегда занимает место, даже до первого ответа (запрос пользователя
              2026-07-31: "дизайн прыгает немного") — раньше рендерилась только при наличии
              data, из-за чего высота шапки менялась между "нет данных" и "есть данные". */}
          <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1">Всего: {data ? data.total : '—'}</p>
        </div>
        {/* Поиск+дропдаун сгруппированы в один flex-элемент (баг-репорт пользователя
            2026-08-04: "поиск лидов встал по центру, из-за дропдауна с проектами"). Studio-
            стилизация+высота поиска ТОЧНО как у соседней кнопки (запрос пользователя
            2026-08-18, второй раз) — см. полный комментарий в .../projects/[id]/clients/page.tsx. */}
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Имя, username, user_id..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-56 h-auto border-0 dark:border dark:border-white/10 px-4 py-2 text-sm rounded-lg bg-white dark:bg-[#171F2B] shadow-sm text-[#131A24] dark:text-[#E9EDF3] placeholder:text-[#92A0AF] focus-visible:ring-2 focus-visible:ring-[#1F4E9C]/40 dark:focus-visible:ring-[#7BA9EE]/40"
          />
          {projects && projects.length > 1 && (
            <Select value={projectId ?? undefined} onValueChange={(v) => { setProjectId(v); setPage(1); }}>
              <SelectTrigger className="w-56 rounded-lg">
                {/* Base UI Select.Value без children рендерит сырой value (id), не текст пункта
                    (4-й раз в проекте, см. clients-filter.tsx:161) — здесь этим value был id
                    проекта, баг был виден невооружённым глазом (запрос пользователя 2026-07-31). */}
                <SelectValue>{(v: string) => projects.find((p) => p.id === v)?.name ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Всегда видимый список доступных сегодня проектов (запрос пользователя 2026-07-31:
          "пусть ему сразу пишет доступные сегодня проекты"). */}
      {projects && projects.length > 0 && (
        <div className="flex items-center flex-wrap gap-2">
          <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Доступные проекты:</span>
          {projects.map((p) => (
            <StudioPill key={p.id} hue={p.id === projectId ? 'amber' : undefined}>
              {p.name}
            </StudioPill>
          ))}
        </div>
      )}

      {projectId && (
        <>
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
                </p>
              )}
            </div>

            <StudioClientsPeriodPicker value={periodValue} onChange={(v) => { setPeriodValue(v); setPage(1); }} />
          </div>

          <ClientsFilter projectId={projectId} value={filters} onChange={(v) => { setFilters(v); setPage(1); }} containerClassName={STUDIO_CARD} />

          <StudioClientsTable
            projectId={projectId}
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

          <ClientDetailDrawer projectId={projectId} clientId={selectedClientId} onClose={() => setSelectedClientId(null)} />
        </>
      )}
    </div>
  );
}
