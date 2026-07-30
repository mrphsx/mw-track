'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ClientsTable, ClientRow } from '@/components/clients/clients-table';
import { ClientDetailDrawer } from '@/components/clients/client-detail-drawer';

interface OverlapMatrix {
  projects: { id: string; name: string }[];
  totals: Record<string, number>;
  pairs: { projectAId: string; projectBId: string; count: number }[];
}

interface OverlapDetailRow {
  tgUserId: string;
  clientA: ClientRow;
  clientB: ClientRow;
}

interface OverlapDetailPage {
  items: OverlapDetailRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const PAGE_SIZE = 20;

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
        <p className="text-sm text-muted-foreground mt-1">
          Клиенты, которые состоят одновременно в нескольких проектах компании — сопоставление
          по Telegram user id. Диагональ — общее число идентифицированных клиентов проекта.
        </p>
      </div>

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
                              <Badge
                                className={`cursor-pointer hover:opacity-80 ${
                                  detailPair && detailPair.a.id === rowProject.id && detailPair.b.id === colProject.id
                                    ? 'ring-2 ring-offset-1 ring-blue-500'
                                    : ''
                                }`}
                              >
                                {count}
                              </Badge>
                            </button>
                          ) : (
                            <span className="text-muted-foreground">0</span>
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

      {detailPair && <OverlapComparisonPanel pair={detailPair} onClose={() => setDetailPair(null)} />}
    </div>
  );
}

// Раньше пересечение открывалось модальным окном с одной плоской строкой на клиента (имя +
// урезанный inA/inB текст) — запрос пользователя 2026-07-30: "начинаешь подгружать лидов в
// форме списка с обеих аккаунтов как две колонки ниже (с пагинацией), чтобы можно было сразу
// сравнить действие и параметры лида в обеих проектах". Теперь это инлайн-панель под таблицей
// (не модалка) с двумя ПОЛНЫМИ ClientsTable рядом — один общий page/limit на пару (не по
// колонке отдельно), чтобы строка N слева и строка N справа гарантированно оставались одним и
// тем же человеком (бэкенд уже возвращает items в этом порядке, см. AudienceService.
// getOverlapDetail). Клик по строке в любой колонке открывает обычный ClientDetailDrawer этого
// же проекта — полная история покупок/событий доступна без ухода со страницы.
function OverlapComparisonPanel({
  pair,
  onClose,
}: {
  pair: { a: { id: string; name: string }; b: { id: string; name: string } };
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{ projectId: string; clientId: string } | null>(null);

  useEffect(() => setPage(1), [pair.a.id, pair.b.id]);

  const { data, isLoading } = useQuery({
    queryKey: ['audience-overlap-detail', pair.a.id, pair.b.id, page],
    queryFn: async () =>
      (
        await api.get<OverlapDetailPage>(`/audience/overlap/${pair.a.id}/${pair.b.id}`, { params: { page, limit: PAGE_SIZE } })
      ).data,
    placeholderData: (prev) => prev,
  });

  const clientsA = data?.items.map((i) => i.clientA) ?? [];
  const clientsB = data?.items.map((i) => i.clientB) ?? [];

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-medium">
            {pair.a.name} ∩ {pair.b.name}
            {data && <span className="text-sm text-muted-foreground font-normal ml-2">{data.total} клиентов</span>}
          </h2>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {isLoading && !data && <p className="text-sm text-muted-foreground">Загрузка...</p>}
        {data && data.items.length === 0 && <p className="text-sm text-muted-foreground">Пересечений не найдено.</p>}

        {!!data?.items.length && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground truncate">{pair.a.name}</h3>
              <div className="border rounded-lg bg-card overflow-x-auto">
                <ClientsTable projectId={pair.a.id} clients={clientsA} onSelect={(clientId) => setSelected({ projectId: pair.a.id, clientId })} />
              </div>
            </div>
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground truncate">{pair.b.name}</h3>
              <div className="border rounded-lg bg-card overflow-x-auto">
                <ClientsTable projectId={pair.b.id} clients={clientsB} onSelect={(clientId) => setSelected({ projectId: pair.b.id, clientId })} />
              </div>
            </div>
          </div>
        )}

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Страница {data.page} из {data.totalPages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Назад
              </Button>
              <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                Вперёд
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <ClientDetailDrawer
        projectId={selected?.projectId ?? ''}
        clientId={selected?.clientId ?? null}
        onClose={() => setSelected(null)}
      />
    </Card>
  );
}
