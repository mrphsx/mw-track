'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface OverlapMatrix {
  projects: { id: string; name: string }[];
  totals: Record<string, number>;
  pairs: { projectAId: string; projectBId: string; count: number }[];
}

interface OverlapDetailRow {
  tgUserId: string;
  tgFirstName: string | null;
  tgLastName: string | null;
  tgUsername: string | null;
  inA: { hasPurchase: boolean; totalSpent: string; isSubscribed: boolean };
  inB: { hasPurchase: boolean; totalSpent: string; isSubscribed: boolean };
}

export default function AudiencePage() {
  const [detailPair, setDetailPair] = useState<{ a: { id: string; name: string }; b: { id: string; name: string } } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['audience-overlap'],
    queryFn: async () => (await api.get<OverlapMatrix>('/audience/overlap')).data,
  });

  const getCount = (aId: string, bId: string): number => {
    if (!data) return 0;
    if (aId === bId) return data.totals[aId] || 0;
    const pair = data.pairs.find(
      (p) => (p.projectAId === aId && p.projectBId === bId) || (p.projectAId === bId && p.projectBId === aId),
    );
    return pair?.count || 0;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Пересечение аудиторий</h1>
        <p className="text-sm text-gray-500 mt-1">
          Клиенты, которые состоят одновременно в нескольких проектах компании — сопоставление
          по Telegram user id. Диагональ — общее число идентифицированных клиентов проекта.
        </p>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Загрузка...</p>}

      {!isLoading && (data?.projects.length ?? 0) < 2 && (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">
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
                  <th className="p-2 text-left text-sm text-gray-500"></th>
                  {data.projects.map((p) => (
                    <th key={p.id} className="p-2 text-sm font-medium text-left whitespace-nowrap">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.projects.map((rowProject) => (
                  <tr key={rowProject.id}>
                    <td className="p-2 text-sm font-medium whitespace-nowrap">{rowProject.name}</td>
                    {data.projects.map((colProject) => {
                      const isDiagonal = rowProject.id === colProject.id;
                      const count = getCount(rowProject.id, colProject.id);
                      return (
                        <td key={colProject.id} className="p-2 text-center">
                          {isDiagonal ? (
                            <Badge variant="outline">{count}</Badge>
                          ) : count > 0 ? (
                            <button
                              type="button"
                              onClick={() => setDetailPair({ a: rowProject, b: colProject })}
                              className="inline-flex"
                            >
                              <Badge className="cursor-pointer hover:opacity-80">{count}</Badge>
                            </button>
                          ) : (
                            <span className="text-gray-300">0</span>
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

      <OverlapDetailDialog pair={detailPair} onClose={() => setDetailPair(null)} />
    </div>
  );
}

function OverlapDetailDialog({
  pair,
  onClose,
}: {
  pair: { a: { id: string; name: string }; b: { id: string; name: string } } | null;
  onClose: () => void;
}) {
  const { data: rows, isLoading } = useQuery({
    queryKey: ['audience-overlap-detail', pair?.a.id, pair?.b.id],
    queryFn: async () => (await api.get<OverlapDetailRow[]>(`/audience/overlap/${pair!.a.id}/${pair!.b.id}`)).data,
    enabled: !!pair,
  });

  return (
    <Dialog open={!!pair} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {pair?.a.name} ∩ {pair?.b.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {isLoading && <p className="text-sm text-gray-500">Загрузка...</p>}
          {!isLoading && rows?.length === 0 && <p className="text-sm text-gray-500">Пересечений не найдено.</p>}
          {rows?.map((r) => (
            <div key={r.tgUserId} className="flex items-center justify-between gap-3 border rounded-md px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {r.tgFirstName} {r.tgLastName || ''} {r.tgUsername && <span className="text-gray-500">@{r.tgUsername}</span>}
                </div>
              </div>
              <div className="flex gap-4 shrink-0 text-xs text-gray-500">
                <span>
                  {pair?.a.name}: {r.inA.isSubscribed ? 'подписан' : 'отписан'}
                  {r.inA.hasPurchase ? ` · $${Number(r.inA.totalSpent).toFixed(2)}` : ''}
                </span>
                <span>
                  {pair?.b.name}: {r.inB.isSubscribed ? 'подписан' : 'отписан'}
                  {r.inB.hasPurchase ? ` · $${Number(r.inB.totalSpent).toFixed(2)}` : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
