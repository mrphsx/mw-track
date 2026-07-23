'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ClientRow {
  id: string;
  tgFirstName: string | null;
  tgLastName: string | null;
  tgUsername: string | null;
  email: string | null;
  totalSpent: string;
  isSubscribed: boolean;
  createdAt: string;
}

interface PushRow {
  id: string;
  name: string;
  status: string;
  sentAt: string | null;
  scheduledAt: string | null;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
}

// Клиенты + рассылки одного проекта, внутри дрилл-дауна компании (Фаза 4.3B) — клиенты
// постранично (тот же ClientsService.findMany, что и у обычной CRM, company-wide метода у
// него нет — см. память), рассылки — весь список сразу (PushesService.findAll не
// пагинирован, но пуши одного проекта редко исчисляются сотнями).
export default function AdminProjectDetailPage() {
  const { id, projectId } = useParams<{ id: string; projectId: string }>();
  const [page, setPage] = useState(1);

  const { data: clients } = useQuery({
    queryKey: ['admin-project-clients', id, projectId, page],
    queryFn: async () =>
      (await api.get<{ items: ClientRow[]; total: number; page: number; totalPages: number }>(
        `/admin/companies/${id}/projects/${projectId}/clients`,
        { params: { page, limit: 20 } },
      )).data,
  });

  const { data: pushes } = useQuery({
    queryKey: ['admin-project-pushes', id, projectId],
    queryFn: async () => (await api.get<PushRow[]>(`/admin/companies/${id}/projects/${projectId}/pushes`)).data,
  });

  return (
    <div className="max-w-5xl space-y-6">
      <Link href={`/companies/${id}`} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> К компании
      </Link>

      <Tabs defaultValue="clients">
        <TabsList>
          <TabsTrigger value="clients">Клиенты</TabsTrigger>
          <TabsTrigger value="pushes">Рассылки</TabsTrigger>
        </TabsList>

        <TabsContent value="clients">
          <Card className="mt-4">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Потрачено</TableHead>
                    <TableHead>Подписан</TableHead>
                    <TableHead>Добавлен</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients?.items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">
                          {c.tgFirstName ?? c.email ?? '—'} {c.tgLastName ?? ''}
                        </div>
                        <div className="text-xs text-gray-400">{c.tgUsername ? `@${c.tgUsername}` : c.email}</div>
                      </TableCell>
                      <TableCell className="text-xs">${Number(c.totalSpent).toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge variant={c.isSubscribed ? 'outline' : 'secondary'}>{c.isSubscribed ? 'Да' : 'Нет'}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">{format(new Date(c.createdAt), 'd MMM yyyy', { locale: ru })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {clients && clients.items.length === 0 && <p className="p-4 text-sm text-gray-400">Клиентов нет</p>}
            </CardContent>
          </Card>
          {clients && clients.totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Назад
              </Button>
              <span>
                Страница {clients.page} из {clients.totalPages} ({clients.total} всего)
              </span>
              <Button variant="outline" size="sm" disabled={page >= clients.totalPages} onClick={() => setPage((p) => p + 1)}>
                Вперёд
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="pushes">
          <Card className="mt-4">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Рассылка</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Отправлено</TableHead>
                    <TableHead>Доставлено</TableHead>
                    <TableHead>Ошибок</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pushes?.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{p.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">{p.sentAt ? format(new Date(p.sentAt), 'd MMM HH:mm', { locale: ru }) : '—'}</TableCell>
                      <TableCell className="text-xs text-gray-500">{p.deliveredCount}</TableCell>
                      <TableCell className="text-xs text-gray-500">{p.failedCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {pushes && pushes.length === 0 && <p className="p-4 text-sm text-gray-400">Рассылок нет</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
