'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ClientsFilter, ClientsFilterState } from '@/components/clients/clients-filter';
import { ClientsTable, ClientRow } from '@/components/clients/clients-table';
import { ClientDetailDrawer } from '@/components/clients/client-detail-drawer';

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

export default function ClientsPage() {
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

  // placeholderData: keepPreviousData (запрос пользователя 2026-07-21: "надпись 'Всего' ненадолго
  // пропадает и весь фронтенд прыгает") — при смене queryKey (фильтр/страница/поиск) React Query
  // по умолчанию отдаёт data: undefined на время рефетча, пока не придёт новый ответ; с этой
  // опцией старые данные остаются на экране (и "Всего", и сама таблица) до готовности новых —
  // никакого пропадания/схлопывания layout между запросами.
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
            search: search || undefined,
          },
        })
      ).data,
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Клиенты</h1>
          {data && <p className="text-sm text-gray-500">Всего: {data.total}</p>}
        </div>
        <div className="flex gap-2">
          <Input placeholder="Поиск..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
          <Button variant="outline" onClick={exportLookalike}>
            <Download className="w-4 h-4 mr-1.5" /> Экспорт
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-gray-200 p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => { setOrigin('ours'); setPage(1); }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              origin === 'ours' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Наши клиенты
          </button>
          <button
            type="button"
            onClick={() => { setOrigin('external'); setPage(1); }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              origin === 'external' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Внешние контакты
          </button>
        </div>
        {origin === 'external' && (
          <p className="text-xs text-gray-400">
            Написали в личку/боту или вступили в канал не по нашей ссылке — не учитываются в статистике проекта
          </p>
        )}
      </div>

      <ClientsFilter projectId={id} value={filters} onChange={(v) => { setFilters(v); setPage(1); }} />

      <div className="border rounded-lg bg-white">
        <ClientsTable projectId={id} clients={data?.items ?? []} onSelect={setSelectedClientId} />
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Назад
          </Button>
          <span className="text-sm text-gray-500">
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
