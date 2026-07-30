'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { ClientRow } from '@/components/clients/clients-table';
import { ClientDetailDrawer } from '@/components/clients/client-detail-drawer';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../ui';
import { StudioClientsTable } from '../clients-table';

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

// Studio-версия страницы пересечения аудиторий (запрос пользователя 2026-07-30: "готовить все
// остальные страницы") — логика 1:1 с классической (apps/web/.../(dashboard)/audience/page.tsx),
// файл самодостаточен, полный реskin. Тем же днём (баг-репорт + фича-запрос): пересечение
// раскрывается не модалкой, а инлайн-панелью с двумя StudioClientsTable рядом, с общей
// пагинацией — см. комментарий в OverlapComparisonPanel и в классической версии.
export default function StudioAudiencePage() {
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
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Пересечение аудиторий</h1>
        <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1.5">
          Клиенты, которые состоят одновременно в нескольких проектах компании — сопоставление
          по Telegram user id. Диагональ — общее число идентифицированных клиентов проекта.
        </p>
      </div>

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
                  <th key={p.id} className="p-2 text-sm font-medium text-left whitespace-nowrap text-[#131A24] dark:text-[#E9EDF3]">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.projects.map((rowProject) => (
                <tr key={rowProject.id}>
                  <td className="p-2 text-sm font-medium whitespace-nowrap text-[#131A24] dark:text-[#E9EDF3]">{rowProject.name}</td>
                  {data.projects.map((colProject) => {
                    const isDiagonal = rowProject.id === colProject.id;
                    const count = getCount(rowProject.id, colProject.id);
                    const isSelected = !!detailPair && detailPair.a.id === rowProject.id && detailPair.b.id === colProject.id;
                    return (
                      <td key={colProject.id} className="p-2 text-center">
                        {isDiagonal ? (
                          <StudioPill hue="slate">{count}</StudioPill>
                        ) : count > 0 ? (
                          <button
                            type="button"
                            onClick={() => setDetailPair({ a: rowProject, b: colProject })}
                            className={`inline-flex hover:opacity-80 rounded-lg ${isSelected ? 'ring-2 ring-[#1F4E9C] dark:ring-[#7BA9EE]' : ''}`}
                          >
                            <StudioPill hue="amber">{count}</StudioPill>
                          </button>
                        ) : (
                          <span className="text-[#5F6B7A] dark:text-[#92A0AF]">0</span>
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

      {detailPair && <OverlapComparisonPanel pair={detailPair} onClose={() => setDetailPair(null)} />}
    </div>
  );
}

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
    <div className={`${STUDIO_CARD} p-4 space-y-4`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-medium text-[#131A24] dark:text-[#E9EDF3]">
          {pair.a.name} ∩ {pair.b.name}
          {data && <span className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] font-normal ml-2">{data.total} клиентов</span>}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {isLoading && !data && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}
      {data && data.items.length === 0 && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Пересечений не найдено.</p>}

      {!!data?.items.length && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-medium text-[#5F6B7A] dark:text-[#92A0AF] truncate">{pair.a.name}</h3>
            <StudioClientsTable projectId={pair.a.id} clients={clientsA} onSelect={(clientId) => setSelected({ projectId: pair.a.id, clientId })} />
          </div>
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-medium text-[#5F6B7A] dark:text-[#92A0AF] truncate">{pair.b.name}</h3>
            <StudioClientsTable projectId={pair.b.id} clients={clientsB} onSelect={(clientId) => setSelected({ projectId: pair.b.id, clientId })} />
          </div>
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
          <span>
            Страница {data.page} из {data.totalPages}
          </span>
          <div className="flex gap-2">
            <StudioLinkButton size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Назад
            </StudioLinkButton>
            <StudioLinkButton size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Вперёд
            </StudioLinkButton>
          </div>
        </div>
      )}

      <ClientDetailDrawer projectId={selected?.projectId ?? ''} clientId={selected?.clientId ?? null} onClose={() => setSelected(null)} />
    </div>
  );
}
