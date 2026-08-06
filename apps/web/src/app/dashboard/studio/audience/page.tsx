'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Star, X } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ClientAvatar } from '@/components/clients/client-avatar';
import { ClientRow } from '@/components/clients/clients-table';
import { ClientDetailContent } from '@/components/clients/client-detail-drawer';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../ui';

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
// остальные страницы") — логика 1:1 с классической, файл самодостаточен, полный реskin.
// Оформление панели сравнения прошло 3 раунда правок тем же днём (модалка со строкой →
// 2 таблицы рядом → карточка на клиента с 2 колонками бейджей → ЭТА версия — компактная таблица
// "как на странице клиентов", клик по строке открывает полную карточку в 2 колонках) — см.
// комментарий в OverlapComparisonPanel и в классической версии для полной истории.
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
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<OverlapDetailRow | null>(null);

  useEffect(() => setPage(1), [pair.a.id, pair.b.id]);
  useEffect(() => setPage(1), [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['audience-overlap-detail', pair.a.id, pair.b.id, page, search],
    queryFn: async () =>
      (
        await api.get<OverlapDetailPage>(`/audience/overlap/${pair.a.id}/${pair.b.id}`, {
          params: { page, limit: PAGE_SIZE, search: search || undefined },
        })
      ).data,
    placeholderData: (prev) => prev,
  });

  return (
    <div className={`${STUDIO_CARD} p-4 space-y-4`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-medium text-[#131A24] dark:text-[#E9EDF3]">
          {pair.a.name} ∩ {pair.b.name}
          {data && <span className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] font-normal ml-2">{data.total} клиентов</span>}
        </h2>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Имя, username, user_id..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isLoading && !data && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}
      {data && data.items.length === 0 && (
        <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
          {search ? 'Ничего не найдено по этому запросу.' : 'Пересечений не найдено.'}
        </p>
      )}

      {!!data?.items.length && (
        <div className="rounded-xl border border-[#DCE1E8] dark:border-white/10 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                <th rowSpan={2} className="px-3 py-2 font-medium align-bottom">
                  Клиент
                </th>
                <th colSpan={4} className="px-3 py-2 font-medium text-center border-l border-[#DCE1E8] dark:border-white/10">
                  {pair.a.name}
                </th>
                <th colSpan={4} className="px-3 py-2 font-medium text-center border-l border-[#DCE1E8] dark:border-white/10">
                  {pair.b.name}
                </th>
              </tr>
              <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                <th className="px-3 py-1.5 font-medium border-l border-[#DCE1E8] dark:border-white/10">Подписан</th>
                <th className="px-3 py-1.5 font-medium">Диалог</th>
                <th className="px-3 py-1.5 font-medium">Покупки</th>
                <th className="px-3 py-1.5 font-medium">Бот</th>
                <th className="px-3 py-1.5 font-medium border-l border-[#DCE1E8] dark:border-white/10">Подписан</th>
                <th className="px-3 py-1.5 font-medium">Диалог</th>
                <th className="px-3 py-1.5 font-medium">Покупки</th>
                <th className="px-3 py-1.5 font-medium">Бот</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
              {data.items.map((item) => (
                <tr
                  key={item.tgUserId}
                  className="cursor-pointer hover:bg-[#F3F5F8] dark:hover:bg-white/5"
                  onClick={() => setExpanded(item)}
                >
                  <td className="px-3 py-2 font-medium">
                    <div className="flex items-center gap-2 min-w-0">
                      <ClientAvatar
                        projectId={pair.a.id}
                        clientId={item.clientA.id}
                        hasAvatar={!!item.clientA.tgPhotoUrl}
                        fallbackLetter={item.clientA.tgFirstName || item.clientA.tgUsername || '?'}
                      />
                      <span className="truncate text-[#131A24] dark:text-[#E9EDF3]">{item.clientA.tgFirstName || item.clientA.tgUsername || '—'}</span>
                      {item.clientA.tgIsPremium && <Star className="w-3.5 h-3.5 text-[#1F4E9C] dark:text-[#7BA9EE] fill-current shrink-0" />}
                    </div>
                  </td>
                  <OverlapCompactCells client={item.clientA} borderLeft />
                  <OverlapCompactCells client={item.clientB} borderLeft />
                </tr>
              ))}
            </tbody>
          </table>
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

      <OverlapExpandedDialog item={expanded} pair={pair} onClose={() => setExpanded(null)} />
    </div>
  );
}

function OverlapCompactCells({ client, borderLeft }: { client: ClientRow; borderLeft?: boolean }) {
  return (
    <>
      <td className={`px-3 py-2 whitespace-nowrap text-[#5F6B7A] dark:text-[#92A0AF] ${borderLeft ? 'border-l border-[#DCE1E8] dark:border-white/10' : ''}`}>
        {client.subscribedAt ? format(new Date(client.subscribedAt), 'd MMM yyyy') : '—'}
      </td>
      <td className="px-3 py-2 text-[#131A24] dark:text-[#E9EDF3]">{client.firstDialogueAt ? 'Да' : '—'}</td>
      <td className={`px-3 py-2 ${client.hasPurchase ? 'font-semibold text-[#1F4E9C] dark:text-[#7BA9EE]' : 'text-[#5F6B7A] dark:text-[#92A0AF]'}`}>
        ${Number(client.totalSpent).toFixed(2)}
      </td>
      <td className="px-3 py-2">
        {!client.botActivatedAt ? (
          <StudioPill hue="slate">Не активирован</StudioPill>
        ) : !client.isBotActive ? (
          <StudioPill hue="plum">Заблокирован</StudioPill>
        ) : (
          <StudioPill hue="sage">Активирован</StudioPill>
        )}
      </td>
    </>
  );
}

// Полная карточка клиента в 2 колонках (плюс shadcn Dialog — тот же принцип, что и у всех
// остальных диалогов в Studio: сложные функциональные виджеты переиспользуются без реskin'а).
function OverlapExpandedDialog({
  item,
  pair,
  onClose,
}: {
  item: OverlapDetailRow | null;
  pair: { a: { id: string; name: string }; b: { id: string; name: string } };
  onClose: () => void;
}) {
  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      {/* Баг-репорт пользователя 2026-07-30: "модальное окно слишком маленькое для двух
          клиентов, ничего не помещается" — та же правка, что и в классической версии: почти на
          всю ширину экрана (95vw, потолок 1600px), плюс readOnly на обоих ClientDetailContent
          (тот же баг-репорт: "убери функционал удаления клиента, редактирования, добавления
          покупок" — это просмотр для сравнения, не форма управления). */}
      <DialogContent className="max-w-[95vw] xl:max-w-[1600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {item?.clientA.tgFirstName || item?.clientA.tgUsername || 'Клиент'} — {pair.a.name} ∩ {pair.b.name}
          </DialogTitle>
        </DialogHeader>
        {item && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 divide-y md:divide-y-0 md:divide-x">
            <div className="min-w-0">
              <div className="text-xs font-medium text-muted-foreground px-1 pb-2">{pair.a.name}</div>
              <ClientDetailContent projectId={pair.a.id} clientId={item.clientA.id} onClose={onClose} readOnly />
            </div>
            <div className="min-w-0 md:pl-6">
              <div className="text-xs font-medium text-muted-foreground px-1 pb-2">{pair.b.name}</div>
              <ClientDetailContent projectId={pair.b.id} clientId={item.clientB.id} onClose={onClose} readOnly />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
