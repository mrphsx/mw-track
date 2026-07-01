'use client';

import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export interface ClientRow {
  id: string;
  tgFirstName: string | null;
  tgUsername: string | null;
  channelType: string | null;
  country: string | null;
  city: string | null;
  isSubscribed: boolean;
  isBotActive: boolean;
  hasPurchase: boolean;
  totalSpent: string;
  createdAt: string;
}

interface ClientsTableProps {
  clients: ClientRow[];
  onSelect: (clientId: string) => void;
}

export function ClientsTable({ clients, onSelect }: ClientsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Имя</TableHead>
          <TableHead>Канал</TableHead>
          <TableHead>Страна</TableHead>
          <TableHead>Потрачено</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead>Подписан</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {clients.map((client) => (
          <TableRow key={client.id} className="cursor-pointer" onClick={() => onSelect(client.id)}>
            <TableCell className="font-medium">{client.tgFirstName || client.tgUsername || '—'}</TableCell>
            <TableCell>
              <Badge variant="outline">{client.channelType || '—'}</Badge>
            </TableCell>
            <TableCell>{client.country || '—'}</TableCell>
            <TableCell>${Number(client.totalSpent).toFixed(2)}</TableCell>
            <TableCell>
              {!client.isBotActive ? (
                <Badge variant="destructive">Заблокировал бота</Badge>
              ) : !client.isSubscribed ? (
                <Badge variant="secondary">Отписался</Badge>
              ) : (
                <Badge>Активен</Badge>
              )}
            </TableCell>
            <TableCell className="text-gray-500">{format(new Date(client.createdAt), 'd MMM yyyy')}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
