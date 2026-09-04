'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Star } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ClientAvatar } from '@/components/clients/client-avatar';
import { ClientRow } from '@/components/clients/clients-table';
import { ClientDetailContent } from '@/components/clients/client-detail-drawer';
import { toApiPeriodParams, useAudiencePeriodQueryState } from '@/lib/use-audience-period';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../../../ui';
import { StudioAudiencePeriodPicker } from '../../period-picker';

interface OverlapPairSummary {
  projectA: { id: string; name: string; total: number };
  projectB: { id: string; name: string; total: number };
  intersection: number;
  uniqueA: number;
  uniqueB: number;
  percentA: number;
  percentB: number;
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

// Studio-версия отдельной страницы пары проектов — логика 1:1 с классической, см. комментарий там.
export default function StudioAudiencePairPage() {
  const params = useParams<{ projectAId: string; projectBId: string }>();
  const projectAId = params.projectAId;
  const projectBId = params.projectBId;

  // Дефолт 30d (запрос пользователя 2026-08-31: "изначально поставь чтобы было за 30 дней").
  const [period, setPeriod] = useAudiencePeriodQueryState('30d');
  const periodParams = toApiPeriodParams(period);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<OverlapDetailRow | null>(null);

  useEffect(() => setPage(1), [search, periodParams.period, periodParams.from, periodParams.to]);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['audience-overlap-summary', projectAId, projectBId, periodParams],
    queryFn: async () =>
      (await api.get<OverlapPairSummary>(`/audience/overlap/${projectAId}/${projectBId}/summary`, { params: periodParams })).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['audience-overlap-detail', projectAId, projectBId, page, search, periodParams],
    queryFn: async () =>
      (
        await api.get<OverlapDetailPage>(`/audience/overlap/${projectAId}/${projectBId}`, {
          params: { page, limit: PAGE_SIZE, search: search || undefined, ...periodParams },
        })
      ).data,
    placeholderData: (prev) => prev,
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/audience"
          className="inline-flex items-center gap-1 text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] mb-2"
        >
          <ArrowLeft className="w-4 h-4" /> Все пересечения
        </Link>
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">
          {summary ? `${summary.projectA.name} ∩ ${summary.projectB.name}` : 'Пересечение'}
        </h1>
      </div>

      <StudioAudiencePeriodPicker value={period} onChange={setPeriod} />

      {summaryLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StudioStatCard label={summary.projectA.name} sub="всего подписчиков" value={summary.projectA.total} />
          <StudioStatCard label={summary.projectB.name} sub="всего подписчиков" value={summary.projectB.total} />
          <StudioStatCard
            label="Дубликаты"
            sub={`${summary.percentA}% от ${summary.projectA.name} · ${summary.percentB}% от ${summary.projectB.name}`}
            value={summary.intersection}
            highlight
          />
          <StudioStatCard label={`Уникальных в «${summary.projectA.name}»`} value={summary.uniqueA} />
          <StudioStatCard label={`Уникальных в «${summary.projectB.name}»`} value={summary.uniqueB} />
        </div>
      )}

      <div className={`${STUDIO_CARD} p-4 space-y-4`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-medium text-[#131A24] dark:text-[#E9EDF3]">
            Список пересечений
            {data && <span className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] font-normal ml-2">{data.total} клиентов</span>}
          </h2>
          <Input
            placeholder="Имя, username, user_id..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
        </div>

        {isLoading && !data && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}
        {data && data.items.length === 0 && (
          <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
            {search ? 'Ничего не найдено по этому запросу.' : 'Пересечений не найдено за выбранный период.'}
          </p>
        )}

        {!!data?.items.length && summary && (
          <div className="rounded-xl border border-[#DCE1E8] dark:border-white/10 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                  <th rowSpan={2} className="px-3 py-2 font-medium align-bottom">
                    Клиент
                  </th>
                  <th colSpan={4} className="px-3 py-2 font-medium text-center border-l border-[#DCE1E8] dark:border-white/10">
                    {summary.projectA.name}
                  </th>
                  <th colSpan={4} className="px-3 py-2 font-medium text-center border-l border-[#DCE1E8] dark:border-white/10">
                    {summary.projectB.name}
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
                          projectId={projectAId}
                          clientId={item.clientA.id}
                          hasAvatar={!!item.clientA.tgPhotoUrl}
                          fallbackLetter={item.clientA.tgFirstName || item.clientA.tgUsername || '?'}
                        />
                        <span className="truncate text-[#131A24] dark:text-[#E9EDF3]">
                          {item.clientA.tgFirstName || item.clientA.tgUsername || '—'}
                        </span>
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
      </div>

      {summary && (
        <OverlapExpandedDialog
          item={expanded}
          pair={{ a: { id: projectAId, name: summary.projectA.name }, b: { id: projectBId, name: summary.projectB.name } }}
          onClose={() => setExpanded(null)}
        />
      )}
    </div>
  );
}

function StudioStatCard({ label, value, sub, highlight }: { label: string; value: number; sub?: string; highlight?: boolean }) {
  return (
    <div className={`${STUDIO_CARD} p-4 ${highlight ? 'ring-2 ring-[#1F4E9C] dark:ring-[#7BA9EE]' : ''}`}>
      <div className="text-2xl font-bold text-[#131A24] dark:text-[#E9EDF3]">{value}</div>
      <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] mt-1 truncate" title={label}>
        {label}
      </div>
      {sub && <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] mt-0.5">{sub}</div>}
    </div>
  );
}

function OverlapCompactCells({ client, borderLeft }: { client: ClientRow; borderLeft?: boolean }) {
  return (
    <>
      <td className={`px-3 py-2 whitespace-nowrap text-[#5F6B7A] dark:text-[#92A0AF] ${borderLeft ? 'border-l border-[#DCE1E8] dark:border-white/10' : ''}`}>
        {client.subscribedAt ? format(new Date(client.subscribedAt), 'd MMM yyyy, HH:mm') : '—'}
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
