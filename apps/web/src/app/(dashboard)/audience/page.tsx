'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Star, X } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ClientAvatar } from '@/components/clients/client-avatar';
import { ClientRow } from '@/components/clients/clients-table';
import { ClientDetailContent } from '@/components/clients/client-detail-drawer';

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

// История переделок этой панели за 2026-07-30 (от старой к новой): модалка с одной плоской
// строкой на клиента → две полные ClientsTable рядом → одна карточка на клиента с 2 колонками
// (каждая — набор бейджей) → ЭТА версия (запрос: "нужен список маленький как он сделан на
// странице клиентов... информации не надо много... когда подписался, не статус, есть или нет
// диалога, сумма покупок, статус бота"). Компактная таблица — один клиент на строку, 4 узких
// колонки на каждый проект (Подписан/Диалог/Покупки/Бот), без status-бейджей — тот же принцип
// плотности, что и обычный список клиентов, просто с двумя проекциями рядом вместо одной. Клик
// по строке открывает ОДНУ модалку с полной карточкой клиента (запрос: "при открытии записи
// покажет уже расширенную информацию... со всеми данными что есть в карточке клиента... вплоть
// до данных рекламы") — сразу в двух колонках, по одной на проект, через переиспользуемый
// ClientDetailContent (вынесен из ClientDetailDrawer тем же днём).
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
  // Смена поискового запроса сбрасывает страницу — то же поведение, что и у обычного списка
  // клиентов (запрос пользователя 2026-07-30: "тоже нужен поиск, по имени, user_id, username").
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
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-medium">
            {pair.a.name} ∩ {pair.b.name}
            {data && <span className="text-sm text-muted-foreground font-normal ml-2">{data.total} клиентов</span>}
          </h2>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Имя, username, user_id..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />
            <Button size="icon" variant="ghost" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {isLoading && !data && <p className="text-sm text-muted-foreground">Загрузка...</p>}
        {data && data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {search ? 'Ничего не найдено по этому запросу.' : 'Пересечений не найдено.'}
          </p>
        )}

        {!!data?.items.length && (
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={2} className="align-bottom">
                    Клиент
                  </TableHead>
                  <TableHead colSpan={4} className="text-center border-l">
                    {pair.a.name}
                  </TableHead>
                  <TableHead colSpan={4} className="text-center border-l">
                    {pair.b.name}
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
                          projectId={pair.a.id}
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

      <OverlapExpandedDialog item={expanded} pair={pair} onClose={() => setExpanded(null)} />
    </Card>
  );
}

// 4 узкие колонки на один проект — только то, что попросили ("информации не надо много"): дата
// подписки (не статус-бейдж), диалог да/нет, сумма покупок, статус бота.
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

// Полная карточка клиента в двух колонках — по одной на проект, тот же ClientDetailContent, что
// и обычный ClientDetailDrawer использует для одного проекта (включая блок "Источник трафика" со
// всеми рекламными полями, финансы, историю покупок, удаление GDPR).
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
          клиентов, ничего не помещается" — max-w-5xl (1024px) на 2 колонки с "Источником
          трафика" (13 полей) + финансами + историей покупок было слишком тесно. Расширено до
          почти всей ширины экрана (max-w-[95vw]), с потолком в 1600px, чтобы не растягивалось
          абсурдно широко на ultra-wide мониторах. Заодно (тот же баг-репорт): "убери функционал
          удаления клиента, редактирования, добавления покупок" — readOnly на обоих
          ClientDetailContent, это сравнение для просмотра, а не форма управления. */}
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
