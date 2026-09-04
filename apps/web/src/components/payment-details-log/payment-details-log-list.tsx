'use client';

// Журнал реквизитов (запрос пользователя 2026-08-27) — антифрод-контроль: показывает исходящие
// сообщения с личного Telegram-аккаунта проекта, в которых обнаружены признаки платёжных
// реквизитов (SINPE/крипто-адрес/банковские данные, см. apps/api common/payment-detail-patterns.util.ts).
// Только Owner (см. ProjectsController.getPaymentDetailsLog) — общий компонент для обоих
// деревьев, страницы-обёртки лишь передают projectId и опциональный class для карточки (Studio).
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PeriodSelector } from '@/components/shared/period-selector';
import { usePeriodQueryState } from '@/lib/use-period-query-state';

interface PaymentDetailsLogItem {
  id: string;
  tgUserId: string;
  messageText: string;
  sentAt: string;
  client: { id: string; tgFirstName: string | null; tgLastName: string | null; tgUsername: string | null } | null;
  // Снапшот на момент отправки (запрос пользователя 2026-08-29, "почему айди а не имя") —
  // единственный источник хоть какого-то имени для получателей без записи Client.
  tgFirstName: string | null;
  tgUsername: string | null;
}

interface PaymentDetailsLogResponse {
  items: PaymentDetailsLogItem[];
  total: number;
  page: number;
  pageSize: number;
}

function clientLabel(item: PaymentDetailsLogItem): string {
  if (item.client) {
    const name = [item.client.tgFirstName, item.client.tgLastName].filter(Boolean).join(' ');
    return name || item.client.tgUsername || item.tgUserId;
  }
  // Нет записи Client — единственный источник имени - снапшот на момент отправки (не всегда
  // резолвится, см. TelegramPersonalService.handlePaymentDetailsLog), голый tgUserId — крайний
  // случай, если и он не резолвился.
  return item.tgFirstName || item.tgUsername || item.tgUserId;
}

export function PaymentDetailsLogList({ projectId, containerClassName }: { projectId: string; containerClassName?: string }) {
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Период — тот же селектор/URL-персистентность, что и на главной странице проекта (запрос
  // пользователя 2026-08-29: "добавь периоды как на главной странице проекта"). Дефолт '30d' —
  // журнал по умолчанию не обрезан 30 днями на бэкенде (см. ProjectsService.getPaymentDetailsLog),
  // но UI по умолчанию всё равно показывает недавнее, а не всю историю разом — переключить на
  // более широкий период можно вручную.
  const [period, setPeriod] = usePeriodQueryState('30d');
  // Поиск — простой debounce, без персистентности в URL (упрощение, чтобы не гонять с period за
  // один и тот же query string двумя независимыми router.replace).
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => setPage(1), [period, search]);

  const pageSize = 25;

  const { data, isLoading } = useQuery({
    queryKey: ['payment-details-log', projectId, page, period, search],
    queryFn: async () =>
      (
        await api.get<PaymentDetailsLogResponse>(`/projects/${projectId}/payment-details-log`, {
          params: { page, pageSize, period: period.period, from: period.from, to: period.to, search: search || undefined },
        })
      ).data,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className={containerClassName}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Журнал реквизитов</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Исходящие сообщения с личного аккаунта, в которых обнаружены признаки платёжных реквизитов (SINPE, крипто-адрес,
          банковские данные). Только факт отправки — без сверки с официальными реквизитами компании.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <PeriodSelector value={period} onChange={setPeriod} />
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по тексту сообщения"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ничего не найдено за выбранный период.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Получатель</TableHead>
                <TableHead>Сообщение</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => {
                const isExpanded = expandedId === item.id;
                const preview = item.messageText.length > 120 && !isExpanded ? `${item.messageText.slice(0, 120)}…` : item.messageText;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap align-top">{format(new Date(item.sentAt), 'd MMM yyyy, HH:mm')}</TableCell>
                    <TableCell className="whitespace-nowrap align-top">{clientLabel(item)}</TableCell>
                    <TableCell className="align-top">
                      <div className="whitespace-pre-wrap break-words max-w-xl">{preview}</div>
                      {item.messageText.length > 120 && (
                        <button
                          type="button"
                          className="text-xs text-primary underline mt-1"
                          onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        >
                          {isExpanded ? 'Свернуть' : 'Показать целиком'}
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Назад
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Далее
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
