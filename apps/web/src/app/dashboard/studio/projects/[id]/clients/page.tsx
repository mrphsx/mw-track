'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { ClientsFilter, ClientsFilterState } from '@/components/clients/clients-filter';
import { ClientRow } from '@/components/clients/clients-table';
import { ClientDetailDrawer } from '@/components/clients/client-detail-drawer';
import { StudioClientsTable } from '../../../clients-table';
import { StudioLinkButton } from '../../../ui';

interface ClientsResponse {
  items: ClientRow[];
  total: number;
  page: number;
  totalPages: number;
}

type ClientOrigin = 'ours' | 'external';

// Studio-версия страницы клиентов (запрос пользователя 2026-07-30: "готовить все остальные
// страницы") — логика 1:1 с классической (apps/web/.../(dashboard)/projects/[id]/clients/page.tsx).
// ClientsFilter переиспользован без изменений (сложный самодостаточный виджет — тот же принцип,
// что и у диалогов LandingCard); таблица — общая StudioClientsTable (вынесена в ../../clients-table
// при добавлении этой страницы — раньше жила только внутри страницы проекта).
export default function StudioClientsPage() {
  const { id } = useParams<{ id: string }>();
  const [origin, setOrigin] = useState<ClientOrigin>('ours');
  const [filters, setFilters] = useState<ClientsFilterState>({});
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

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
    queryKey: ['clients', id, origin, filters, search, page],
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
            search: search || undefined,
          },
        })
      ).data,
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
          <Input
            placeholder="Имя, username, user_id..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 rounded-lg"
          />
          <StudioLinkButton icon={Download} onClick={exportLookalike}>
            Экспорт
          </StudioLinkButton>
        </div>
      </div>

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

      <ClientsFilter projectId={id} value={filters} onChange={(v) => { setFilters(v); setPage(1); }} />

      <StudioClientsTable projectId={id} clients={data?.items ?? []} onSelect={setSelectedClientId} />

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
