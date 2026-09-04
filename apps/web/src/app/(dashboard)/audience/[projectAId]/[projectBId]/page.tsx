'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Star } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ClientAvatar } from '@/components/clients/client-avatar';
import { ClientRow } from '@/components/clients/clients-table';
import { ClientDetailContent } from '@/components/clients/client-detail-drawer';
import { AudiencePeriodSelector } from '@/components/shared/audience-period-selector';
import { toApiPeriodParams, useAudiencePeriodQueryState } from '@/lib/use-audience-period';

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

// Отдельная страница пары проектов (запрос пользователя 2026-08-31: "при клике на пересечение
// переносит на новую страницу данной пары проектов, где уже будет подробная информация
// пересечения в обе стороны, сколько уникальных и дубликатов, список клиентов") — раньше это был
// разворачивающийся под матрицей блок на самой /audience, теперь полноценный маршрут со своим
// периодом (не общий с матрицей — можно сузить окно именно для этой пары, не трогая остальную
// матрицу). Список клиентов и разворачиваемая карточка — тот же код, что раньше жил в
// OverlapComparisonPanel/OverlapExpandedDialog на /audience, просто перенесён сюда целиком.
export default function AudiencePairPage() {
  const params = useParams<{ projectAId: string; projectBId: string }>();
  const projectAId = params.projectAId;
  const projectBId = params.projectBId;

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
        <Link href="/audience" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-4 h-4" /> Все пересечения
        </Link>
        <h1 className="text-2xl font-bold">
          {summary ? `${summary.projectA.name} ∩ ${summary.projectB.name}` : 'Пересечение'}
        </h1>
      </div>

      <AudiencePeriodSelector value={period} onChange={setPeriod} />

      {summaryLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label={summary.projectA.name} sub="всего подписчиков" value={summary.projectA.total} />
          <StatCard label={summary.projectB.name} sub="всего подписчиков" value={summary.projectB.total} />
          <StatCard
            label="Дубликаты"
            sub={`${summary.percentA}% от ${summary.projectA.name} · ${summary.percentB}% от ${summary.projectB.name}`}
            value={summary.intersection}
            highlight
          />
          <StatCard label={`Уникальных в «${summary.projectA.name}»`} value={summary.uniqueA} />
          <StatCard label={`Уникальных в «${summary.projectB.name}»`} value={summary.uniqueB} />
        </div>
      )}

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-medium">
              Список пересечений
              {data && <span className="text-sm text-muted-foreground font-normal ml-2">{data.total} клиентов</span>}
            </h2>
            <Input
              placeholder="Имя, username, user_id..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />
          </div>

          {isLoading && !data && <p className="text-sm text-muted-foreground">Загрузка...</p>}
          {data && data.items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {search ? 'Ничего не найдено по этому запросу.' : 'Пересечений не найдено за выбранный период.'}
            </p>
          )}

          {!!data?.items.length && summary && (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead rowSpan={2} className="align-bottom">
                      Клиент
                    </TableHead>
                    <TableHead colSpan={4} className="text-center border-l">
                      {summary.projectA.name}
                    </TableHead>
                    <TableHead colSpan={4} className="text-center border-l">
                      {summary.projectB.name}
                    </TableHead>
                  </TableRow>
                  <TableRow>
                    <TableHead className="border-l">Подписан</TableHead>
                    <TableHead>Диалог</TableHead>
                    <TableHead>Покупки</TableHead>
                    <TableHead>Бот</TableHead>
                    <TableHead className="border-l">Подписан</TableHead>
                    <TableHead>Диалог</TableHead>
                    <TableHead>Покупки</TableHead>
                    <TableHead>Бот</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item) => (
                    <TableRow key={item.tgUserId} className="cursor-pointer" onClick={() => setExpanded(item)}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <ClientAvatar
                            projectId={projectAId}
                            clientId={item.clientA.id}
                            hasAvatar={!!item.clientA.tgPhotoUrl}
                            fallbackLetter={item.clientA.tgFirstName || item.clientA.tgUsername || '?'}
                          />
                          <span className="truncate">{item.clientA.tgFirstName || item.clientA.tgUsername || '—'}</span>
                          {item.clientA.tgIsPremium && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />}
                        </div>
                      </TableCell>
                      <OverlapCompactCells client={item.clientA} borderLeft />
                      <OverlapCompactCells client={item.clientB} borderLeft />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
      </Card>

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

function StatCard({ label, value, sub, highlight }: { label: string; value: number; sub?: string; highlight?: boolean }) {
  return (
    <Card className={highlight ? 'border-blue-500 dark:border-blue-500' : ''}>
      <CardContent className="p-4">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground mt-1 truncate" title={label}>
          {label}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function OverlapCompactCells({ client, borderLeft }: { client: ClientRow; borderLeft?: boolean }) {
  return (
    <>
      <TableCell className={`text-sm text-muted-foreground whitespace-nowrap ${borderLeft ? 'border-l' : ''}`}>
        {client.subscribedAt ? format(new Date(client.subscribedAt), 'd MMM yyyy, HH:mm') : '—'}
      </TableCell>
      <TableCell className="text-sm">{client.firstDialogueAt ? 'Да' : '—'}</TableCell>
      <TableCell className={`text-sm ${client.hasPurchase ? 'font-semibold text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
        ${Number(client.totalSpent).toFixed(2)}
      </TableCell>
      <TableCell>
        {!client.botActivatedAt ? (
          <Badge variant="outline">Не активирован</Badge>
        ) : !client.isBotActive ? (
          <Badge variant="destructive">Заблокирован</Badge>
        ) : (
          <Badge>Активирован</Badge>
        )}
      </TableCell>
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
