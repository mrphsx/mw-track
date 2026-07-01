'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
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

export default function ClientsPage() {
  const { id } = useParams<{ id: string }>();
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
    queryKey: ['clients', id, filters, search, page],
    queryFn: async () =>
      (
        await api.get<ClientsResponse>(`/projects/${id}/clients`, {
          params: {
            page,
            channelType: filters.channelType,
            hasPurchase: filters.hasPurchase,
            country: filters.country,
            minSpent: filters.minSpent,
            search: search || undefined,
          },
        })
      ).data,
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

      <ClientsFilter value={filters} onChange={(v) => { setFilters(v); setPage(1); }} />

      <div className="border rounded-lg bg-white">
        <ClientsTable clients={data?.items ?? []} onSelect={setSelectedClientId} />
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
